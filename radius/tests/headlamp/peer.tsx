import { registerRoute } from '@kinvolk/headlamp-plugin/lib';
import { Background, Controls, ReactFlow } from '@xyflow/react';

const nodes = [
  { id: 'a', position: { x: 0, y: 0 }, data: { label: 'Host peer A' } },
  { id: 'b', position: { x: 260, y: 160 }, data: { label: 'Host peer B' } },
];
const edges = [{ id: 'a-b', source: 'a', target: 'b' }];

function PeerGraph() {
  return (
    <div aria-label="Host peer graph" style={{ width: 750, height: 500 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}

registerRoute({
  path: '/radius-qualification-peer',
  name: 'radius-qualification-peer',
  sidebar: null,
  useClusterURL: false,
  noAuthRequired: true,
  component: PeerGraph,
});
