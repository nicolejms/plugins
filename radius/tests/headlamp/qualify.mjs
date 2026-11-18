import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { build, mergeConfig } from 'vite';
import sdkConfig from '@kinvolk/headlamp-plugin/config/vite.config.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
process.chdir(root);
const work = mkdtempSync(join(tmpdir(), 'radius-headlamp-'));
const output = resolve(process.env.RADIUS_QUALIFICATION_DIR || join(work, 'results'));
mkdirSync(output, { recursive: true });
const image =
  'ghcr.io/headlamp-k8s/headlamp:v0.45.0@sha256:db3f0e0fc58d358d41daa3fe7fc852437552c7ee873c3645470f7b86a8e0db49';
const container = `radius-graph-${randomUUID()}`;
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const save = (name, value) =>
  writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
const docker = args =>
  execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000, stdio: 'pipe' }).trim();
const scope = '/planes/radius/local/resourceGroups/shop/providers/Applications.Core/';
const application = {
  id: scope + 'applications/store',
  name: 'store',
  type: 'Applications.Core/applications',
  location: 'global',
  properties: { environment: scope + 'environments/dev', provisioningState: 'Succeeded' },
  systemData: { createdBy: 'fixture' },
};
const web = {
  id: scope + 'containers/web',
  name: 'web',
  type: 'Applications.Core/containers',
  location: 'global',
  properties: { application: application.id, provisioningState: 'Succeeded' },
};
const db = {
  id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Sql/servers/sql/databases/db',
  name: 'db',
  type: 'Microsoft.Sql/servers/databases',
};
const graphPayload = {
  resources: [
    {
      ...web,
      provisioningState: 'Succeeded',
      outputResources: [],
      connections: [{ id: db.id, direction: 'Outbound' }],
    },
    { ...db, provisioningState: 'Succeeded', outputResources: [], connections: [] },
  ],
};

let browser;
let page;
let started = false;
let graphMode = 'normal';
const actionRequests = [];
const errors = [];
const consoleErrors = [];
try {
  const plugin = join(work, 'plugins', 'radius');
  mkdirSync(plugin, { recursive: true });
  cpSync(join(root, 'dist'), plugin, { recursive: true });
  cpSync(join(root, 'package.json'), join(plugin, 'package.json'));
  const peer = join(work, 'plugins', 'radius-peer');
  await build(
    mergeConfig(sdkConfig, {
      build: {
        outDir: peer,
        lib: { entry: join(root, 'tests', 'headlamp', 'peer.tsx') },
      },
    })
  );
  writeFileSync(
    join(peer, 'package.json'),
    JSON.stringify({
      name: 'radius-qualification-peer',
      version: '0.0.0',
      devDependencies: { '@kinvolk/headlamp-plugin': '0.14.0' },
    })
  );
  writeFileSync(
    join(work, 'kubeconfig'),
    [
      'apiVersion: v1',
      'kind: Config',
      'clusters:',
      '- name: qualification',
      '  cluster:',
      '    server: http://127.0.0.1:9',
      'contexts:',
      '- name: qualification',
      '  context:',
      '    cluster: qualification',
      '    user: fixture',
      'users:',
      '- name: fixture',
      '  user: {}',
      'current-context: qualification',
      '',
    ].join('\n')
  );
  docker([
    'run',
    '--detach',
    '--entrypoint',
    '/headlamp/headlamp-server',
    '--name',
    container,
    '--publish',
    '127.0.0.1::4466',
    '--mount',
    `type=bind,source=${work},target=/qualification,readonly`,
    image,
    '-plugins-dir',
    '/qualification/plugins',
    '-user-plugins-dir',
    '/tmp/radius-user-plugins',
    '-kubeconfig-dir',
    '/tmp/radius-kubeconfigs',
    '-kubeconfig',
    '/qualification/kubeconfig',
    '-html-static-dir',
    '/headlamp/frontend',
  ]);
  started = true;
  const port = docker(['port', container, '4466/tcp']).split(':').pop();
  const origin = `http://127.0.0.1:${port}`;
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(origin)).status;
        } catch (error) {
          if (error.cause?.code === 'ECONNREFUSED' || error.cause?.code === 'UND_ERR_SOCKET')
            return 0;
          throw error;
        }
      },
      { timeout: 30_000 }
    )
    .toBe(200);
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const pluginRequests = [];
  page.on('request', request => {
    if (/plugins.*main\.js/.test(request.url())) pluginRequests.push(request.url());
  });
  // Only test data is intercepted. Headlamp, pluginLib, routes, CSS, and the renderer are real.
  await page.route('**/clusters/qualification/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let data = { kind: 'List', metadata: { resourceVersion: '1' }, items: [] };
    let status = 200;
    if (path.endsWith('/getGraph')) {
      actionRequests.push({
        url: url.pathname + url.search,
        method: request.method(),
        body: request.postData(),
      });
      data =
        graphMode === 'empty'
          ? { resources: [] }
          : graphMode === 'malformed'
          ? {}
          : graphMode === 'error'
          ? { message: 'Fixture action denied' }
          : graphMode === 'warning'
          ? {
              resources: [
                {
                  ...web,
                  connections: [{ id: scope + 'containers/missing', direction: 'Outbound' }],
                },
              ],
            }
          : graphPayload;
      if (graphMode === 'error') status = 403;
      if (graphMode === 'status') {
        data = {
          ...graphPayload,
          resources: graphPayload.resources.map(resource => ({
            ...resource,
            provisioningState: 'Updating',
          })),
        };
      }
    } else if (path.includes('/apis/api.ucp.dev/')) {
      data = {
        value: path.endsWith('/applications')
          ? [application]
          : path.endsWith('/containers')
          ? [web]
          : [],
      };
    } else if (path.endsWith('/selfsubjectrulesreviews')) {
      data = {
        status: {
          resourceRules: [{ verbs: ['*'], apiGroups: ['*'], resources: ['*'] }],
          nonResourceRules: [],
          incomplete: false,
        },
      };
    } else if (path.endsWith('/me')) {
      data = { username: 'fixture', groups: [] };
    } else if (path.endsWith('/version')) {
      data = { major: '1', minor: '31', gitVersion: 'v1.31.0' };
    } else if (path.endsWith('/apis')) {
      data = { kind: 'APIGroupList', groups: [] };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });

  const appUrl = `${origin}/c/qualification/applications/store`;
  await page.goto(appUrl);
  const graph = page.getByRole('region', { name: 'Application resource graph', exact: true });
  const cards = graph.locator('[data-radius-part="node"]');
  await expect(cards).toHaveCount(2, { timeout: 30_000 });
  await expect(graph.locator('.react-flow__edge-path')).toHaveCount(1);
  assert.ok(
    pluginRequests.some(url => url.includes('/radius/')),
    'Headlamp must load the built plugin'
  );
  assert.deepEqual(actionRequests[0], {
    url: `/clusters/qualification/apis/api.ucp.dev/v1alpha3${application.id}/getGraph?api-version=2023-10-01-preview`,
    method: 'POST',
    body: '{}',
  });
  const geometry = await cards.evaluateAll(elements =>
    elements.map(element => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        x: rect.x,
        y: rect.y,
        cssWidth: getComputedStyle(element).width,
      };
    })
  );
  for (const rect of geometry) {
    assert.ok([rect.width, rect.height, rect.x, rect.y].every(Number.isFinite));
    assert.ok(rect.width > 100 && rect.height > 30, 'Cards must have usable geometry');
    assert.equal(rect.cssWidth, '220px', 'The public graph stylesheet must size each card');
  }
  const edgePath = await graph.locator('.react-flow__edge-path').getAttribute('d');
  assert.ok(edgePath && !/NaN|Infinity/.test(edgePath), 'Edges must have finite geometry');
  const viewport = graph.locator('.react-flow__viewport');
  const before = await viewport.getAttribute('style');
  await graph.getByRole('button', { name: /zoom in/i }).click();
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(before);
  const details = graph.locator('[data-radius-part="details-toggle"]').first();
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(graph.locator('[data-radius-part="details"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toBeFocused();
  await expect(graph.locator('[data-radius-part="details"]')).not.toBeVisible();
  await graph.locator('[data-radius-part="node"]').filter({ hasText: 'web' }).click();
  const zoomed = await viewport.getAttribute('style');
  const requestCount = actionRequests.length;
  graphMode = 'status';
  await page.getByRole('button', { name: 'Reload graph', exact: true }).click();
  await expect.poll(() => actionRequests.length).toBe(requestCount + 1);
  await expect(page.getByText('Loading application graph', { exact: true })).toHaveCount(0);
  await expect(graph.locator('[data-radius-part="status"]').first()).toHaveText('Updating');
  await expect(viewport).toHaveAttribute('style', zoomed);
  await expect(page.getByRole('link', { name: 'Open web resource details' })).toBeVisible();
  graphMode = 'normal';
  // Select by label rather than layout order: Dagre is free to reorder cards.
  await graph.locator('[data-radius-part="node"]').filter({ hasText: 'web' }).click();
  await page.getByRole('link', { name: 'Open web resource details' }).click();
  await expect(page.getByRole('heading', { name: 'web', exact: true })).toBeVisible();
  assert.ok(page.url().includes('/resources/'), 'Use the existing resource detail route');
  await page.goBack();
  await expect(cards).toHaveCount(2);
  await graph.locator('[data-radius-part="node"]').filter({ hasText: 'db' }).click();
  await expect(page.getByText('db has no resource detail page in this plugin.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open db resource details' })).toHaveCount(0);

  for (const mode of ['error', 'malformed', 'empty', 'warning', 'normal']) {
    graphMode = mode;
    await page.getByRole('button', { name: /^(Reload graph|Retry)$/ }).click();
    if (mode === 'error' || mode === 'malformed') {
      await expect(
        page.getByRole('alert').filter({ hasText: 'Could not load the application graph' })
      ).toContainText(mode === 'error' ? 'Fixture action denied' : 'resources must be an array');
      await expect(page.getByRole('heading', { name: 'Resources (1)' })).toBeVisible();
    } else if (mode === 'empty') {
      await expect(graph.locator('[data-radius-part="empty"]')).toBeVisible();
    } else if (mode === 'warning') {
      await expect(graph.locator('[data-radius-part="warning"]').first()).toBeVisible();
    } else {
      await expect(cards).toHaveCount(2);
    }
  }
  await page.screenshot({ path: join(output, 'light.png'), fullPage: true });
  await graph.screenshot({ path: join(output, 'light-graph.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(cards).toHaveCount(2);
  await expect
    .poll(() => graph.evaluate(element => getComputedStyle(element).colorScheme))
    .toBe('dark');
  await page.screenshot({ path: join(output, 'dark.png'), fullPage: true });
  await page.setViewportSize({ width: 700, height: 1000 });
  await expect(cards).toHaveCount(2);
  await graph.getByRole('button', { name: /fit view/i }).click();
  await expect
    .poll(() =>
      graph.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll('[data-radius-part="node"]')].every(node => {
          const card = node.getBoundingClientRect();
          return card.left >= bounds.left && card.right <= bounds.right;
        });
      })
    )
    .toBe(true);
  const graphWidth = await graph.evaluate(element => element.getBoundingClientRect().width);
  assert.ok(graphWidth > 200 && graphWidth <= 700);
  await graph.screenshot({ path: join(output, 'narrow.png') });

  await page.goto(`${origin}/radius-qualification-peer`);
  const peerRoot = page.getByLabel('Host peer graph');
  await expect(peerRoot.locator('.react-flow__controls-button')).toHaveCount(4);
  const hostCss = await (await fetch(`${origin}/assets/GraphView-Cdd0UtY8.css`)).text();
  assert.ok(hostCss.includes('.react-flow'), 'Load the actual Headlamp GraphView stylesheet');
  const radiusCss = readFileSync(
    join(root, 'node_modules', '@radius-project', 'graph-react', 'dist', 'styles.css'),
    'utf8'
  );
  const samples = await page.evaluate(
    ({ hostCss, radiusCss }) => {
      let removed = 0;
      for (const style of document.querySelectorAll('style')) {
        if (style.textContent.includes('@scope (.radius-graph)')) {
          style.remove();
          removed++;
        }
      }
      const sample = () =>
        [
          ...document.querySelectorAll(
            '[aria-label="Host peer graph"] .react-flow__controls-button'
          ),
        ].map(button => {
          const css = getComputedStyle(button);
          return Object.fromEntries(
            [
              'width',
              'height',
              'padding',
              'border',
              'boxSizing',
              'backgroundColor',
              'color',
              'borderRadius',
            ].map(key => [key, css[key]])
          );
        });
      const host = document.createElement('style');
      host.textContent = hostCss;
      const radius = document.createElement('style');
      radius.textContent = radiusCss;
      document.head.append(host);
      const baseline = sample();
      document.head.append(radius);
      const radiusLast = sample();
      host.remove();
      document.head.append(host);
      return { removed, baseline, radiusLast, hostLast: sample() };
    },
    { hostCss, radiusCss }
  );
  assert.ok(samples.removed > 0, 'Remove the real Radius stylesheet for the baseline');
  assert.deepEqual(
    samples.radiusLast,
    samples.baseline,
    'Radius CSS must not change host controls'
  );
  assert.deepEqual(samples.hostLast, samples.baseline, 'Styles must work in either load order');
  assert.deepEqual(errors, [], 'No page errors');
  assert.deepEqual(
    consoleErrors.filter(message => !/WebSocket|Failed to load resource:.*403/.test(message)),
    []
  );
  save('receipt.json', {
    image,
    browser: browser.version(),
    node: process.version,
    bundleSha256: hash(join(root, 'dist', 'main.js')),
    lockSha256: hash(join(root, 'package-lock.json')),
    coreSha256: hash(join(root, 'vendor', 'radius-project-core-0.1.0.tgz')),
    graphSha256: hash(join(root, 'vendor', 'radius-project-graph-react-0.1.0.tgz')),
    geometry,
    samples,
    actionRequests,
    errors,
    consoleErrors,
    liveClusterAuthVerified: false,
  });
  console.log(`Headlamp qualification passed. Evidence: ${output}`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
    writeFileSync(join(output, 'failure.html'), await page.content());
  }
  save('failure.json', { error: String(error), errors, consoleErrors, actionRequests });
  console.error(`Headlamp qualification failed. Evidence: ${output}`);
  throw error;
} finally {
  if (browser) await browser.close();
  if (started) {
    writeFileSync(join(output, 'headlamp.log'), docker(['logs', container]));
    docker(['rm', '--force', container]);
  }
  rmSync(join(work, 'plugins'), { recursive: true, force: true });
  rmSync(join(work, 'kubeconfig'), { force: true });
}
