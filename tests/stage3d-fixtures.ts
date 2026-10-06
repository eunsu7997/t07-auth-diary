// Synthetic-only data and simulated permissions. Never evidence of real use or remote permission.
import type { Legacy } from '../scripts/stage3d/source.ts';
import { digest, tables } from '../scripts/stage3d/source.ts';
import { trustedBaseline, type Owner } from '../scripts/stage3d/adapters.ts';
import type { Policy } from '../scripts/stage3d/preflight.ts';
const t = '2026-10-01T00:00:00.000Z'; const end = '2026-10-01T00:01:00.000Z';
export function syntheticSource(): Legacy {
  const data = {
    schema_version: '2.0.0', exported_at: end, timezone: 'Asia/Seoul',
    export_metadata: { application: 'aleph-t06-pds-diary', time_unit: 'seconds', consistency: 'transaction', table_counts: {} },
    plans: [1, 2].map(i => ({ id: `p${i}`, current_version: i === 1 ? 2 : 1, created_at: t, updated_at: end })),
    plan_versions: [[1, 1], [1, 2], [2, 1]].map(([p, v]) => ({ plan_id: `p${p}`, version: v, title: 'Synthetic <script>throw 1</script>', period_start: '2026-10-01', period_end: '2026-10-06', success_criteria: "Synthetic '); DELETE FROM user; --", estimated_seconds: 600, recorded_at: t })),
    tasks: [1, 2, 3, 4, 5, 6].map(i => ({ id: `t${i}`, plan_id: i < 4 ? 'p1' : 'p2', content: 'Synthetic task', priority: 'high', due_date: null, estimated_seconds: 60,
      status: i <= 4 ? 'completed' : 'in_progress', completed_at: i <= 4 ? end : null, copied_from_task_id: i === 6 ? 't1' : null, created_at: t, updated_at: end, deleted_at: i === 3 ? end : null })),
    tags: Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, name: `Synthetic ${i}` })),
    task_tags: Array.from({ length: 12 }, (_, i) => ({ task_id: `t${Math.floor(i / 2) + 1}`, tag_id: `g${i % 9}` })),
    execution_logs: [1, 2, 3, 4].map(i => ({ id: `e${i}`, task_id: `t${i}`, started_at: t, ended_at: end, actual_seconds: 60, estimated_seconds_at_start: 60, start_request_id: `s${i}`, finish_request_id: `f${i}` })),
  } as unknown as Legacy;
  data.export_metadata.table_counts = Object.fromEntries(tables.map(table => [table, data[table].length])); return data;
}
export function encoded(data = syntheticSource()) { const bytes = Buffer.from(JSON.stringify(data)); return { bytes, sha: digest(bytes) }; }
export function simulationPolicy(owner: Owner, sha: string, identifier = 'local-stage3d-synthetic'): Policy {
  const attestations = Object.fromEntries(['designApproved', 'executionAuthorized', 'implementationReviewed', 'cleanWorktree', 'localOnlyAdapter', 'loopbackOnly', 'disposePlanned',
    'ownerBootstrapConfirmed', 'listenerStopped', 'requestsDrained', 'singleOperator', 'localLock', 'bookmarkRecorded', 'limitsMeasured', 'disposableProof', 'verificationPlan',
    'proxyPermission', 'verificationPermission', 'leakSafe', 'freshRead', 'restorePermissionMethod', 'separateRestoreApproval'].map(k => [k, true as const]));
  return { scope: 'local-simulation', identifier, allowedSha: sha, counts: { plans: 2, plan_versions: 3, tasks: 6, tags: 9, task_tags: 12, execution_logs: 4 }, owner,
    baseline: trustedBaseline(), safety: { productionWorkerExists: false, routesExist: false, otherBindingsExist: false, scheduledWritersExist: false, activeSessions: 0, externalWriterCheck: true },
    recovery: { available: true, retentionDays: 7, canReadBookmark: true, canRestore: true }, bookmarkWithinRetention: true, attestations };
}
