// Offline rehearsal only. Never imported by the Worker or normal user API.
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { LocalDatabase, projectRoot } from '../src/server/local-db.ts';
export const tables = ['plans','plan_versions','tasks','tags','task_tags','execution_logs'] as const;
type Row = Record<string, string | number | null>;
export type Legacy = { schema_version: string; export_metadata: { table_counts: Record<string, number> } } & Record<typeof tables[number], Row[]>;
const schema = JSON.parse(readFileSync(new URL('../contracts/pds-schema-v2.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({strict:false,allErrors:true}); addFormats(ajv);
const validate = ajv.compile(schema);
const fail = (message: string): never => { throw new Error(message); };
export function validateLegacy(input: unknown): asserts input is Legacy {
  if (!validate(input)) fail('T06 schema validation failed (values withheld)');
  const data = input as Legacy;
  for (const table of tables) {
    if (data[table].length !== data.export_metadata.table_counts[table]) fail('Source count mismatch');
    const key = schema['x-database'][table].primary_key as string[];
    if (new Set(data[table].map(r=>JSON.stringify(key.map(k=>r[k])))).size !== data[table].length) fail('Duplicate source primary key');
    for (const fk of schema['x-database'][table].foreign_keys as {column:string;table:typeof tables[number];target:string}[]) {
      const ids=new Set(data[fk.table].map(r=>r[fk.target]));
      if (data[table].some(r=>r[fk.column]!==null && !ids.has(r[fk.column]))) fail('Broken source foreign key');
    }
  }
  for (const p of data.plans) if (!data.plan_versions.some(v=>v.plan_id===p.id && v.version===p.current_version)) fail('Missing current plan version');
  for (const field of ['start_request_id','finish_request_id']) {
    const ids=data.execution_logs.map(r=>r[field]).filter(x=>x!==null);
    if (new Set(ids).size!==ids.length) fail('Duplicate execution request key');
  }
  for (const t of data.tasks) {
    const open=data.execution_logs.filter(e=>e.task_id===t.id && e.ended_at===null);
    if(open.length>1 || (open.length && (t.status==='completed'||t.deleted_at!==null))) fail('Invalid active execution');
    if ((t.status==='completed') !== (t.completed_at!==null)) fail('Invalid completion state');
  }
  for (const e of data.execution_logs) {
    if(e.ended_at===null) { if(e.actual_seconds!==null||e.finish_request_id!==null) fail('Invalid open execution'); }
    else if(e.finish_request_id===null || e.actual_seconds!==Math.floor((Date.parse(String(e.ended_at))-Date.parse(String(e.started_at)))/1000) || Number(e.actual_seconds)<0) fail('Invalid closed execution');
  }
}
export const canonical = (rows: Row[]) => rows.map(r=>Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function businessSnapshot(db: LocalDatabase): Record<typeof tables[number], Row[]> {
  return Object.fromEntries(tables.map(t=>[t,db.sqlite.prepare(`SELECT * FROM ${t}`).all()])) as Record<typeof tables[number], Row[]>;
}
export function compareLegacy(data: Legacy, output: Record<string, unknown>, owner: string) {
  return Object.fromEntries(tables.map(t=>[t, isDeepStrictEqual(canonical(data[t]),canonical((output[t] as Row[]).map(row=>{
    const copy={...row}; if(t==='plans'||t==='tags') { if(copy.owner_user_id!==owner) fail('Owner mismatch'); delete copy.owner_user_id; } return copy;
  })))])) as Record<typeof tables[number], boolean>;
}
export function triggerSnapshot(db: LocalDatabase) {
  return db.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all() as {name:string;sql:string}[];
}
export function importLegacy(db: LocalDatabase, input: unknown, owner: string) {
  // Restrict to memory test DBs and dedicated ignored rehearsal files; not .data/t07.sqlite.
  const path=String(db.sqlite.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file ?? '');
  if(path) { const rel=relative(resolve(projectRoot,'.data/stage3a'),resolve(path)); if(!rel || rel.startsWith('..') || isAbsolute(rel)) fail('Only dedicated local rehearsal DBs are allowed'); }
  validateLegacy(input);
  const before=triggerSnapshot(db);
  const bypass=['execution_start_guard','task_copy_source_guard','copied_task_owner'];
  if(bypass.some(n=>!before.some(t=>t.name===n))) fail('Required import guards missing');
  db.sqlite.exec('BEGIN IMMEDIATE');
  try {
    if(!db.sqlite.prepare('SELECT id FROM user WHERE id=?').get(owner)) fail('Explicit existing owner required');
    if(tables.some(t=>Number(db.sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get()?.n)>0)) fail('Import rejected: business DB must be empty');
    db.sqlite.exec('PRAGMA defer_foreign_keys=ON');
    for(const name of bypass) db.sqlite.exec(`DROP TRIGGER ${name}`);
    for(const table of tables) {
      const columns=Object.keys(schema.$defs[table].properties) as string[];
      const owned=table==='plans'||table==='tags';
      const fields=owned?[...columns,'owner_user_id']:columns;
      const insert=db.sqlite.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`);
      for(const row of input[table]) insert.run(...columns.map(c=>row[c]),...(owned?[owner]:[]));
    }
    for(const trigger of before.filter(t=>bypass.includes(t.name))) db.sqlite.exec(trigger.sql);
    if(!isDeepStrictEqual(before,triggerSnapshot(db))) fail('Trigger restoration failed');
    if(db.sqlite.prepare('PRAGMA foreign_key_check').all().length) fail('Foreign key check failed');
    if(Object.values(compareLegacy(input,businessSnapshot(db),owner)).some(x=>!x)) fail('Business field comparison failed');
    db.sqlite.exec('COMMIT');
    return {success:true,rows:Object.fromEntries(tables.map(t=>[t,input[t].length])),temporaryTriggerBypass:bypass,triggerCount:before.length,triggerSqlSha256:createHash('sha256').update(JSON.stringify(before)).digest('hex'),triggersRestored:true,foreignKeyCheck:true};
  } catch { db.sqlite.exec('ROLLBACK'); throw new Error('Local import rejected and rolled back; no business data committed'); }
}
export function independentMetrics(data: Legacy, today: string) {
  const date=(s:unknown)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(String(s)));
  const estimated=data.tasks.reduce((s,t)=>s+Number(t.estimated_seconds),0);
  const actual=data.execution_logs.filter(e=>e.ended_at!==null).reduce((s,e)=>s+Number(e.actual_seconds),0);
  return {plan_count:data.plans.length,completed_count:data.tasks.filter(t=>t.status==='completed').length,delayed_count:data.tasks.filter(t=>t.due_date!==null && (t.status==='completed'?date(t.completed_at)>String(t.due_date):today>String(t.due_date))).length,task_estimated_seconds:estimated,actual_seconds:actual,difference_seconds:actual-estimated};
}
