import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApplicationGraph } from './applicationGraph';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  cluster: 'cluster-a' as string | null,
  version: '2023-10-01-preview',
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: mocks.request },
  K8s: { useCluster: () => mocks.cluster },
}));
vi.mock('../config', () => ({ getUCPApiVersion: () => mocks.version }));

const appId =
  '/planes/radius/local/resourceGroups/shop/providers/Applications.Core/applications/store';
const resourceId =
  '/planes/radius/local/resourceGroups/shop/providers/Applications.Core/containers/web';
const payload = {
  resources: [
    { id: resourceId, name: 'web', type: 'Applications.Core/containers', connections: [] },
  ],
};

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue(payload);
  mocks.cluster = 'cluster-a';
  mocks.version = '2023-10-01-preview';
});
afterEach(cleanup);

describe('useApplicationGraph', () => {
  it('posts the full legacy action with JSON, explicit cluster, and Headlamp auth', async () => {
    const { result } = renderHook(() => useApplicationGraph(appId));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.graph?.resources).toHaveLength(1));
    expect(mocks.request).toHaveBeenCalledWith(
      `/apis/api.ucp.dev/v1alpha3${appId}/getGraph?api-version=2023-10-01-preview`,
      {
        method: 'POST',
        cluster: 'cluster-a',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: expect.any(AbortSignal),
      },
      true,
      true
    );
    expect(result.current.graph?.context).toEqual({
      connectionId: 'cluster-a',
      plane: { type: 'radius', name: 'local' },
      applicationId: appId,
    });
    expect(result.current.graph?.resources[0]).not.toHaveProperty('deployStatus');
  });

  it('resets on cluster, full application identity, plane, and API version changes', async () => {
    const { result, rerender } = renderHook(({ id }) => useApplicationGraph(id), {
      initialProps: { id: appId },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const next = deferred();
    mocks.request.mockReturnValueOnce(next.promise);
    mocks.cluster = 'cluster-b';
    rerender({ id: appId });
    expect(result.current.graph).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => next.resolve(payload));
    expect(result.current.graph?.context.connectionId).toBe('cluster-b');

    const otherId = appId.replace('/local/', '/other/').replace('/shop/', '/other-group/');
    rerender({ id: otherId });
    await waitFor(() => expect(result.current.graph?.context.applicationId).toBe(otherId));
    expect(result.current.graph?.context.plane.name).toBe('other');

    mocks.version = 'new version';
    rerender({ id: otherId });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.request.mock.lastCall?.[0]).toContain('api-version=new%20version');
    expect(mocks.request).toHaveBeenCalledTimes(4);
  });

  it('ignores late responses from the previous context and aborts on unmount', async () => {
    const late = deferred();
    mocks.request.mockReturnValueOnce(late.promise);
    const { result, rerender, unmount } = renderHook(({ id }) => useApplicationGraph(id), {
      initialProps: { id: appId },
    });
    const firstSignal: AbortSignal = mocks.request.mock.calls[0][1].signal;
    const otherId = appId.replace('/shop/', '/other/');
    rerender({ id: otherId });
    await waitFor(() => expect(result.current.graph?.context.applicationId).toBe(otherId));
    await act(async () => late.resolve({ resources: [] }));
    expect(result.current.graph?.resources).toHaveLength(1);
    expect(firstSignal.aborted).toBe(true);
    const signal: AbortSignal = mocks.request.mock.lastCall?.[1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('does not publish a result when an unmounted request resolves', async () => {
    const late = deferred();
    mocks.request.mockReturnValueOnce(late.promise);
    const { result, unmount } = renderHook(() => useApplicationGraph(appId));
    const initial = result.current;
    unmount();
    await act(async () => late.resolve(payload));
    expect(result.current).toBe(initial);
  });

  it('keeps the mounted graph during a same-context refresh for viewport and selection retention', async () => {
    const { result } = renderHook(() => useApplicationGraph(appId));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const previous = result.current.graph;
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise);
    act(() => result.current.retry());
    expect(result.current.loading).toBe(true);
    expect(result.current.graph).toBe(previous);
    await act(async () => pending.resolve(payload));
    expect(result.current.loading).toBe(false);
    expect(result.current.graph).not.toBe(previous);
  });

  it('passes normalized Inbound and Outbound connections to the renderer without duplicate edges', async () => {
    const target = { ...payload.resources[0], id: `${resourceId}-db`, name: 'db' };
    mocks.request.mockResolvedValueOnce({
      resources: [
        {
          ...payload.resources[0],
          connections: [{ id: target.id, direction: 'Outbound' }],
        },
        { ...target, connections: [{ id: resourceId, direction: 'Inbound' }] },
      ],
    });
    const { result } = renderHook(() => useApplicationGraph(appId));
    await waitFor(() => expect(result.current.graph?.resources).toHaveLength(2));
    expect(result.current.graph?.resources[0].connections).toEqual([
      { id: target.id, direction: 'Outbound' },
    ]);
    expect(result.current.graph?.resources[1].connections).toEqual([]);
  });

  it.each(['401 Unauthorized', '403 Forbidden', '404 getGraph is not supported'])(
    'reports action errors and retries: %s',
    async message => {
      mocks.request.mockRejectedValueOnce(new Error(message));
      const { result } = renderHook(() => useApplicationGraph(appId));
      await waitFor(() => expect(result.current.error?.message).toBe(message));
      expect(result.current.graph).toBeNull();
      act(() => result.current.retry());
      expect(result.current.loading).toBe(true);
      await waitFor(() => expect(result.current.graph?.resources).toHaveLength(1));
      expect(result.current.error).toBeNull();
      expect(mocks.request).toHaveBeenCalledTimes(2);
    }
  );

  it('distinguishes an empty response from malformed data', async () => {
    mocks.request.mockResolvedValueOnce({ resources: [] }).mockResolvedValueOnce({});
    const { result } = renderHook(() => useApplicationGraph(appId));
    await waitFor(() => expect(result.current.graph?.resources).toEqual([]));
    expect(result.current.error).toBeNull();
    act(() => result.current.retry());
    await waitFor(() =>
      expect(result.current.error?.message).toContain('resources must be an array')
    );
    expect(result.current.graph).toBeNull();
  });

  it('retains shared normalization warnings and does not invent edges', async () => {
    mocks.request.mockResolvedValueOnce({
      resources: [
        {
          ...payload.resources[0],
          connections: [{ id: `${resourceId}-missing`, direction: 'Outbound' }],
        },
      ],
    });
    const { result } = renderHook(() => useApplicationGraph(appId));
    await waitFor(() => expect(result.current.graph).not.toBeNull());
    expect(result.current.graph?.warnings[0].code).toBe('unresolved-connection');
    expect(result.current.graph?.resources[0].connections).toEqual([]);
  });

  it.each(['/providers/Applications.Core/applications/store', resourceId])(
    'rejects a non-application identity without sending a request: %s',
    async id => {
      const { result } = renderHook(() => useApplicationGraph(id));
      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(mocks.request).not.toHaveBeenCalled();
    }
  );

  it('does not fall back to another cluster when no cluster is selected', async () => {
    mocks.cluster = null;
    const { result } = renderHook(() => useApplicationGraph(appId));
    await waitFor(() => expect(result.current.error?.message).toContain('Select a cluster'));
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
