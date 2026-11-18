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

import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { parseResourceId } from '@radius-project/core/domain';
import { graphContextKey, LiveGraph, normalizeLiveGraph } from '@radius-project/core/graph';
import { useCallback, useEffect, useState } from 'react';
import { getUCPApiVersion } from '../config';

interface GraphResult {
  key: string;
  attempt: number;
  graph: LiveGraph | null;
  error: Error | null;
}

export function useApplicationGraph(applicationId: string, apiVersion = getUCPApiVersion()) {
  const cluster = K8s.useCluster();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<GraphResult | null>(null);
  const key = JSON.stringify([cluster, applicationId, apiVersion]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function fetchGraph() {
      try {
        if (!cluster) {
          throw new Error('Select a cluster to load the application graph.');
        }
        const application = parseResourceId(applicationId);
        if (!application?.plane) {
          throw new Error('The application graph needs a full Radius application ID.');
        }
        const context = {
          connectionId: cluster,
          plane: application.plane,
          applicationId,
        };
        graphContextKey(context);
        const payload: unknown = await ApiProxy.request(
          `/apis/api.ucp.dev/v1alpha3${applicationId}/getGraph?api-version=${encodeURIComponent(
            apiVersion
          )}`,
          {
            method: 'POST',
            cluster,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
            signal: controller.signal,
          },
          true,
          true
        );
        if (active) {
          setResult({ key, attempt, graph: normalizeLiveGraph(payload, context), error: null });
        }
      } catch (error) {
        if (active) {
          setResult({
            key,
            attempt,
            graph: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    }

    fetchGraph();
    return () => {
      active = false;
      controller.abort();
    };
  }, [cluster, applicationId, apiVersion, key, attempt]);

  // Hide the previous context during the render before its replacement effect runs.
  const current = result?.key === key ? result : null;
  const loading = current === null || current.attempt !== attempt;
  return {
    graph: current?.graph ?? null,
    error: loading ? null : current?.error ?? null,
    loading,
    retry,
  };
}
