// Explicit offline dry-run: no Wrangler imports, network calls, source copies or persistent DB.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../../src/server/local-db.ts';
import { loadSource, ACTUAL_SHA } from './source.ts';
import { LocalImportDatabase, FakeLoopbackAuthAdapter } from './adapters.ts';
import { generatePlan, executeLocalPlan, classifyOutcome } from './import-plan.ts';
import { simulationPolicy } from '../../tests/stage3d-fixtures.ts';
const db = new LocalImportDatabase('local-stage3d-actual-dry-run');
try {
  const source = loadSource();
  const auth = new FakeLoopbackAuthAdapter(db); const owner = await auth.signup(); await auth.logout();
  const policy = simulationPolicy(owner, ACTUAL_SHA, db.identifier);
  const before = db.inspect(); const plan = generatePlan(db, source, policy);
  await executeLocalPlan(db, plan);
  if (classifyOutcome(db.inspect(), before, source, owner.id) !== 'COMPLETED') throw new Error('LOCAL_DRY_RUN_FAILED');
  // Strict evidence allowlist: source SHA/counts and measured generator metadata only.
  const output = { sourceSha256: source.sha, counts: source.counts, generator: plan.metrics };
  const directory = resolve(projectRoot, 'evidence/t07/stage3d'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'actual-source-dry-run.json'), JSON.stringify(output, null, 2) + '\n');
  console.log('LOCAL_DRY_RUN_PASS');
} catch { console.error('LOCAL_DRY_RUN_FAILED'); process.exitCode = 1; }
finally { db.close(); }
