import { beforeEach, afterEach, expect, it } from 'vitest';
import { LocalDatabase } from '../src/server/local-db.ts';
import { Diary } from '../src/server/services.ts';
import { account } from './fixtures.ts';
import { businessSnapshot, compareLegacy, importLegacy, triggerSnapshot, validateLegacy, tables, type Legacy } from '../scripts/import-t06-local.ts';
let db:LocalDatabase; let a:Awaited<ReturnType<typeof account>>; let source:Legacy;
beforeEach(async()=>{
  db=new LocalDatabase(':memory:'); a=await account(db);
  const origin=new LocalDatabase(':memory:');
  try {
    const u=await account(origin); let now='2026-10-01T00:00:00.000Z'; const d=new Diary(origin,u.userId,()=>now);
    const input={title:'Synthetic import fixture',period_start:'2026-10-01',period_end:'2026-10-06',success_criteria:'Synthetic only',estimated_seconds:600};
    const p=await d.createPlan(input); await d.updatePlan(p.id,{...input,title:'Synthetic revision'},1);
    const t=await d.createTask(p.id,{content:'Synthetic task',priority:'high',due_date:null,estimated_seconds:60,tags:['fixture']});
    const log=await d.start(t.id,crypto.randomUUID()); now='2026-10-01T00:01:00.000Z'; await d.finish(t.id,log.id,crypto.randomUUID());
    await d.copyCompleted(p.id,{plan:input,tasks:[{task_id:t.id,due_date:null}]});
    await d.reopen(t.id); await d.deleteTask(t.id);
    const exported=await d.exportAll();
    source={...exported,schema_version:'2.0.0',export_metadata:{...exported.export_metadata,application:'aleph-t06-pds-diary'}} as unknown as Legacy;
    for(const table of ['plans','tags'] as const) for(const row of source[table]) delete row.owner_user_id;
  } finally {origin.close();}
});
afterEach(()=>db.close());
it('valid v2 import preserves every business field and explicitly assigns owner',()=>{
  expect(importLegacy(db,source,a.userId).success).toBe(true);
  expect(Object.values(compareLegacy(source,businessSnapshot(db),a.userId)).every(Boolean)).toBe(true);
});
it('invalid schema rejected before writes',()=>{
  expect(()=>importLegacy(db,{...source,schema_version:'3.0.0'},a.userId)).toThrow();
  expect(tables.every(t=>businessSnapshot(db)[t].length===0)).toBe(true);
});
it('broken foreign key rejected',()=>{
  source.tasks[0].plan_id='missing'; expect(()=>importLegacy(db,source,a.userId)).toThrow();
});
it('missing current version rejected',()=>{
  source.plans[0].current_version=999; expect(()=>validateLegacy(source)).toThrow();
});
it('duplicate import rejected with business data and trigger SQL unchanged',()=>{
  importLegacy(db,source,a.userId); const before=businessSnapshot(db); const triggers=triggerSnapshot(db);
  expect(()=>importLegacy(db,source,a.userId)).toThrow(); expect(businessSnapshot(db)).toEqual(before); expect(triggerSnapshot(db)).toEqual(triggers);
});
it('late SQL failure rolls back rows and restores dropped guards atomically',()=>{
  db.sqlite.exec("CREATE TRIGGER fixture_import_failure BEFORE INSERT ON tags BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  const triggers=triggerSnapshot(db); expect(()=>importLegacy(db,source,a.userId)).toThrow();
  expect(tables.every(t=>businessSnapshot(db)[t].length===0)).toBe(true); expect(triggerSnapshot(db)).toEqual(triggers);
});
it('all original plan and task IDs and all versions remain',()=>{
  importLegacy(db,source,a.userId); const snap=businessSnapshot(db);
  for(const t of ['plans','plan_versions','tasks'] as const) expect(compareLegacy(source,snap,a.userId)[t]).toBe(true);
});
it('copy links survive even when historical source is now archived and reopened',()=>{
  importLegacy(db,source,a.userId); expect(source.tasks.some(t=>t.copied_from_task_id!==null)).toBe(true);
  expect(compareLegacy(source,businessSnapshot(db),a.userId).tasks).toBe(true);
});
it('execution identities, request keys, durations and timestamps remain exact',()=>{
  importLegacy(db,source,a.userId); expect(source.execution_logs.length).toBe(1);
  expect(compareLegacy(source,businessSnapshot(db),a.userId).execution_logs).toBe(true);
});
it('restores exact trigger SQL, FK constraints and execution guards',()=>{
  const before=triggerSnapshot(db); importLegacy(db,source,a.userId);
  expect(triggerSnapshot(db)).toEqual(before); expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const archived=source.tasks.find(t=>t.deleted_at!==null)!;
  expect(()=>db.sqlite.prepare('INSERT INTO execution_logs (id,task_id,started_at,estimated_seconds_at_start,start_request_id) VALUES (?,?,?,?,?)').run('new-fixture',archived.id,'2026-10-06T00:00:00.000Z',1,'new-fixture-request')).toThrow();
});
it('A/B APIs isolate imported plans, tasks, review and export',async()=>{
  importLegacy(db,source,a.userId); const b=await account(db);
  expect((await a.app.request('/api/plans/'+source.plans[0].id)).status).toBe(200);
  const active=source.tasks.find(t=>t.deleted_at===null)!;
  for(const path of ['/api/plans/'+source.plans[0].id,'/api/tasks/'+active.id,'/api/review?plan_id='+source.plans[0].id]) expect((await b.app.request(path)).status).toBe(404);
  const e=await (await b.app.request('/api/export')).json() as Record<string,unknown[]>; for(const t of tables) expect(e[t]).toEqual([]);
  const review=await (await b.app.request('/api/review')).json() as {plan_count:number;evidence:{tasks:unknown[]}}; expect(review.plan_count).toBe(0); expect(review.evidence.tasks).toEqual([]);
});
it('v3 export round-trip preserves v2 business records and excludes auth tables',async()=>{
  importLegacy(db,source,a.userId); const e=await (await a.app.request('/api/export')).json() as Record<string,unknown>;
  expect(e.schema_version).toBe('3.0.0'); expect(Object.values(compareLegacy(source,e,a.userId)).every(Boolean)).toBe(true);
  expect(Object.keys(e).sort()).toEqual(['schema_version','exported_at','timezone','export_metadata',...tables].sort());
});
it('explicit valid owner required and inconsistent closed duration rejected',()=>{
  expect(()=>importLegacy(db,source,'missing-owner')).toThrow();
  source.execution_logs[0].actual_seconds=999; expect(()=>importLegacy(db,source,a.userId)).toThrow();
});
