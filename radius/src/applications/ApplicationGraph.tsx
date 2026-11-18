/*
 * Copyright 2026 The Headlamp Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, CircularProgress, Typography, useTheme } from '@mui/material';
import { parseResourceId } from '@radius-project/core/domain';
import { graphContextKey, LiveGraph } from '@radius-project/core/graph';
import { RadiusGraph } from '@radius-project/graph-react';
import { useState } from 'react';
import { useApplicationGraph } from '../models/applicationGraph';
import { UCPResource } from '../models/radius';

export default function ApplicationGraph({
  applicationId,
  resources,
}: Readonly<{ applicationId: string; resources: UCPResource[] | null }>) {
  const { graph, loading, error, retry } = useApplicationGraph(applicationId);

  return (
    <SectionBox title="Application graph">
      {loading && (
        <Box display="flex" alignItems="center" gap={2} p={2} role="status">
          <CircularProgress size={24} />
          <Typography>Loading application graph</Typography>
        </Box>
      )}
      {error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={retry}>
              Retry
            </Button>
          }
        >
          Could not load the application graph: {error.message}
        </Alert>
      )}
      {graph && (
        <GraphView
          key={graphContextKey(graph.context)}
          graph={graph}
          resources={resources}
          retry={retry}
        />
      )}
    </SectionBox>
  );
}

function GraphView({
  graph,
  resources,
  retry,
}: Readonly<{ graph: LiveGraph; resources: UCPResource[] | null; retry: () => void }>) {
  const theme = useTheme();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = graph.resources.find(resource => resource.id === selectedId);
  const parsed = selected && parseResourceId(selected.id);
  // The existing detail page inventories only legacy resources on radius/local.
  const canNavigate =
    parsed?.plane?.type.toLowerCase() === 'radius' &&
    parsed.plane.name.toLowerCase() === 'local' &&
    resources?.some(resource => resource.id === selected?.id);

  return (
    <>
      <Box sx={{ width: '100%', height: { xs: 500, md: 600 }, minWidth: 0 }}>
        <RadiusGraph
          graph={graph}
          ariaLabel="Application resource graph"
          theme={{
            colorScheme: theme.palette.mode,
            background: theme.palette.background.paper,
            text: theme.palette.text.primary,
            mutedText: theme.palette.text.secondary,
            accent: theme.palette.primary.main,
            fontFamily: theme.typography.fontFamily,
          }}
          callbacks={{
            onSelect: node => setSelectedId(node.id),
            onRetry: retry,
          }}
        />
      </Box>
      <Box aria-live="polite" sx={{ mt: 2 }}>
        {selected ? (
          canNavigate ? (
            <Link
              routeName="resource-detail"
              params={{ resourceId: encodeURIComponent(selected.id) }}
            >
              Open {selected.name} resource details
            </Link>
          ) : (
            <Typography color="textSecondary">
              {selected.name} has no resource detail page in this plugin.
            </Typography>
          )
        ) : (
          <Typography color="textSecondary">
            Select a resource to view its details. Use the graph controls to zoom.
          </Typography>
        )}
      </Box>
      <Button onClick={retry} sx={{ mt: 1 }}>
        Reload graph
      </Button>
    </>
  );
}
