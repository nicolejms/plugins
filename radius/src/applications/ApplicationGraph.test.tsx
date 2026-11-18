import { createTheme, ThemeProvider } from '@mui/material';
import type { LiveGraph } from '@radius-project/core/graph';
import type { RadiusGraphProps } from '@radius-project/graph-react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useApplicationGraph } from '../models/applicationGraph';
import type { UCPApplication, UCPResource } from '../models/radius';
import ApplicationDetailView from './ApplicationDetailView';
import ApplicationGraph from './ApplicationGraph';

const mocks = vi.hoisted(() => ({
  state: {} as ReturnType<typeof useApplicationGraph>,
  graphProps: undefined as RadiusGraphProps | undefined,
}));
vi.mock('../models/applicationGraph', () => ({
  useApplicationGraph: () => mocks.state,
}));
vi.mock('@radius-project/graph-react', () => ({
  RadiusGraph: (props: RadiusGraphProps) => {
    mocks.graphProps = props;
    return (
      <button
        onClick={() =>
          props.callbacks?.onSelect?.({
            id: props.graph.resources[0]?.id ?? '',
            borderColor: '',
            borderWidth: 1,
            bgColor: '',
            icon: '',
            nodeName: '',
            typeLabel: '',
            concreteType: '',
            codeRef: '',
            sourceUrl: '',
            srcPath: '',
            srcLine: 0,
            defFile: '',
            defLine: 0,
            resourceType: '',
            diffStatus: '',
            deployStatus: '',
            portalUrl: '',
            cloudResources: '',
          })
        }
      >
        Select graph resource
      </button>
    );
  },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  ),
  Link: ({
    routeName,
    params,
    children,
  }: {
    routeName: string;
    params: Record<string, string>;
    children: ReactNode;
  }) => <a href={`/${routeName}/${Object.values(params)[0]}`}>{children}</a>,
  Table: ({ data }: { data: UCPResource[] }) => (
    <table>
      <tbody>
        {data.map(resource => (
          <tr key={resource.id}>
            <td>{resource.name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
vi.mock('../models/radius', () => ({
  useRadiusApplications: () => [[application], null, false],
  useApplicationResources: () => [[resource], null, false],
}));
vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ applicationName: 'store' }),
}));

const appId =
  '/planes/radius/local/resourceGroups/shop/providers/Applications.Core/applications/store';
const resource: UCPResource = {
  id: '/planes/radius/local/resourceGroups/shop/providers/Applications.Core/containers/web',
  name: 'web',
  type: 'Applications.Core/containers',
  location: 'global',
  properties: {},
};
const application: UCPApplication = {
  id: appId,
  name: 'store',
  type: 'Applications.Core/applications',
  location: 'global',
  properties: { environment: '/environments/dev' },
  systemData: { createdBy: 'test-actor' },
};
const graph: LiveGraph = {
  kind: 'live',
  context: {
    connectionId: 'cluster-a',
    plane: { type: 'radius', name: 'local' },
    applicationId: appId,
  },
  resources: [{ id: resource.id, name: resource.name, type: resource.type, connections: [] }],
  warnings: [],
};

beforeEach(() => {
  mocks.state = { graph, loading: false, error: null, retry: vi.fn() };
  mocks.graphProps = undefined;
});
afterEach(cleanup);

describe('ApplicationGraph', () => {
  it('shows loading and a recoverable error without mounting the renderer', () => {
    mocks.state = { ...mocks.state, graph: null, loading: true };
    const { rerender } = render(<ApplicationGraph applicationId={appId} resources={null} />);
    expect(screen.getByRole('status').textContent).toContain('Loading application graph');
    expect(mocks.graphProps).toBeUndefined();
    mocks.state = { ...mocks.state, loading: false, error: new Error('403 Forbidden') };
    rerender(<ApplicationGraph applicationId={appId} resources={null} />);
    expect(screen.getByRole('alert').textContent).toContain('403 Forbidden');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.state.retry).toHaveBeenCalledOnce();
  });

  it('keeps graph data stable and maps both host themes without a separate React root', () => {
    const { rerender } = render(
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <ApplicationGraph applicationId={appId} resources={[resource]} />
      </ThemeProvider>
    );
    expect(mocks.graphProps?.graph).toBe(graph);
    expect(mocks.graphProps?.theme?.colorScheme).toBe('dark');
    rerender(
      <ThemeProvider theme={createTheme({ palette: { mode: 'light' } })}>
        <ApplicationGraph applicationId={appId} resources={[resource]} />
      </ThemeProvider>
    );
    expect(mocks.graphProps?.graph).toBe(graph);
    expect(mocks.graphProps?.theme?.colorScheme).toBe('light');
  });

  it('uses Headlamp navigation only for a resource in its existing inventory', () => {
    const { rerender } = render(<ApplicationGraph applicationId={appId} resources={[resource]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select graph resource' }));
    expect(
      screen.getByRole('link', { name: 'Open web resource details' }).getAttribute('href')
    ).toBe(`/resource-detail/${encodeURIComponent(resource.id)}`);
    rerender(<ApplicationGraph applicationId={appId} resources={[]} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('web has no resource detail page in this plugin.')).toBeTruthy();
    expect(mocks.graphProps?.callbacks?.onNavigate).toBeUndefined();
  });

  it('does not link unsupported cloud resources or carry selection across graph contexts', () => {
    const cloud = {
      ...resource,
      id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/data',
    };
    mocks.state = {
      ...mocks.state,
      graph: { ...graph, resources: [{ ...cloud, connections: [] }] },
    };
    const { rerender } = render(<ApplicationGraph applicationId={appId} resources={[cloud]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select graph resource' }));
    expect(screen.queryByRole('link')).toBeNull();
    mocks.state = {
      ...mocks.state,
      graph: { ...graph, context: { ...graph.context, connectionId: 'other-cluster' } },
    };
    rerender(<ApplicationGraph applicationId={appId} resources={[resource]} />);
    expect(screen.getByText(/Select a resource to view its details/)).toBeTruthy();
  });

  it('passes empty graphs and warnings to the shared renderer and reloads through the hook', () => {
    const empty: LiveGraph = {
      ...graph,
      resources: [],
      warnings: [
        {
          code: 'invalid-resource-id',
          severity: 'warning',
          resourceId: 'invalid',
          message: 'Resource with an unrecognized ID ignored: invalid',
        },
      ],
    };
    mocks.state = { ...mocks.state, graph: empty };
    render(<ApplicationGraph applicationId={appId} resources={[]} />);
    expect(mocks.graphProps?.graph).toBe(empty);
    fireEvent.click(screen.getByRole('button', { name: 'Reload graph' }));
    expect(mocks.state.retry).toHaveBeenCalledOnce();
  });

  it('retains all existing detail sections and the resource table when the graph fails', () => {
    mocks.state = { ...mocks.state, graph: null, error: new Error('Action not supported') };
    render(
      <MemoryRouter>
        <ApplicationDetailView />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: 'General Information' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Environment & Compute' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'System Information' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Resources (1)' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'web' })).toBeTruthy();
    expect(screen.getByText('test-actor')).toBeTruthy();
    const sections = screen.getAllByRole('heading').map(heading => heading.textContent);
    expect(sections.indexOf('Application graph')).toBeLessThan(sections.indexOf('Resources (1)'));
  });
});
