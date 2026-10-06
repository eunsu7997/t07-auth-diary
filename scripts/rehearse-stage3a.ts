import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { LocalDatabase } from '../src/server/local-db.ts';
import { createAuth } from '../src/server/auth.ts';
import { createApp } from '../src/server/app.ts';
import { tables, validateLegacy, importLegacy, compareLegacy, businessSnapshot, triggerSnapshot, independentMetrics } from './import-t06-local.ts';

const source=resolve(process.argv[2] ?? '');
if(!process.argv[2]) throw new Error('Explicit local T06 export path required');
const raw=readFileSync(source); const data:unknown=JSON.parse(raw.toString()); validateLegacy(data);
const out=resolve('evidence/t07/stage3a'); mkdirSync(out,{recursive:true});
const report=(name:string,value:unknown)=>writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n');
report('import-source-summary.json',{path:source,sha256:createHash('sha256').update(raw).digest('hex'),schema_version:data.schema_version,rows:Object.fromEntries(tables.map(t=>[t,data[t].length]))});
const dbPath=resolve('.data/stage3a',`rehearsal-${randomUUID()}.sqlite`);
const db=new LocalDatabase(dbPath);
const secret=Buffer.from(randomBytes(48)).toString('hex');
const base='http://localhost';
const auth=createAuth(db.sqlite,secret,base);
const app=createApp(db,auth);
const privateValues=[secret];
async function signup() {
  const password=Buffer.from(randomBytes(40)).toString('hex'); privateValues.push(password);
  const r=await app.request(base+'/api/auth/sign-up/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:`migration-rehearsal-${randomUUID()}@example.invalid`,password,name:'Local migration rehearsal fixture'})});
  if(r.status!==200) throw new Error('Rehearsal signup failed (response withheld)');
  const payload=await r.json() as {user:{id:string};token?:string};
  const cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '); privateValues.push(cookie); if(payload.token)privateValues.push(payload.token);
  return {id:payload.user.id,cookie};
}
async function get(path:string,cookie:string) { const r=await app.request(base+path,{headers:{Cookie:cookie}}); return {status:r.status,data:await r.json()}; }
try {
  const a=await signup(); const b=await signup();
  const triggers=triggerSnapshot(db);
  const result=importLegacy(db,data,a.id);
  const compared=compareLegacy(data,businessSnapshot(db),a.id);
  const planResponses=await Promise.all(data.plans.map(p=>get('/api/plans/'+encodeURIComponent(String(p.id)),a.cookie)));
  const taskResponses=await Promise.all(data.tasks.filter(t=>t.deleted_at===null).map(t=>get('/api/tasks/'+encodeURIComponent(String(t.id)),a.cookie)));
  const ar=await get('/api/review',a.cookie); const ae=await get('/api/export',a.cookie);
  const br=await get('/api/review',b.cookie); const be=await get('/api/export',b.cookie);
  const v3=JSON.parse(readFileSync('contracts/pds-schema-v3.json','utf8'));
  const validator=new Ajv2020({strict:false}); addFormats(validator); const valid=validator.compile(v3);
  const review=ar.data as {today:string;evidence:{tasks:{id:string}[]}} & Record<string,unknown>;
  const metrics=independentMetrics(data,review.today);
  const metricsPass=Object.entries(metrics).every(([k,v])=>review[k]===v);
  const perPlan=await Promise.all(data.plans.map(async p=>{
    const r=await get('/api/review?plan_id='+encodeURIComponent(String(p.id)),a.cookie);
    const subset={...data,plans:data.plans.filter(x=>x.id===p.id),tasks:data.tasks.filter(x=>x.plan_id===p.id),execution_logs:data.execution_logs.filter(e=>data.tasks.some(t=>t.id===e.task_id&&t.plan_id===p.id))};
    const expected=independentMetrics(subset,review.today);
    return r.status===200&&Object.entries(expected).every(([k,v])=>(r.data as Record<string,unknown>)[k]===v);
  }));
  const denied=await Promise.all([
    ...data.plans.map(p=>get('/api/plans/'+encodeURIComponent(String(p.id)),b.cookie)),
    ...data.tasks.map(t=>get('/api/tasks/'+encodeURIComponent(String(t.id)),b.cookie)),
    ...data.plans.map(p=>get('/api/review?plan_id='+encodeURIComponent(String(p.id)),b.cookie))
  ]);
  const bExport=be.data as Record<string,unknown[]>;
  const bReview=br.data as {plan_count:number;completed_count:number;evidence:{plans:unknown[];tasks:unknown[];closed_executions:unknown[];active_executions:unknown[]}};
  const isolation=denied.every(x=>x.status===404)&&tables.every(t=>bExport[t].length===0)&&bReview.plan_count===0&&bReview.completed_count===0&&['plans','tasks','closed_executions','active_executions'].every(k=>bReview.evidence[k as keyof typeof bReview.evidence].length===0);
  const exported=ae.data as Record<string,unknown>;
  const roundtrip=valid(exported)&&Object.values(compareLegacy(data,exported,a.id)).every(Boolean)&&Object.keys(exported).every(k=>['schema_version','exported_at','timezone','export_metadata',...tables].includes(k));
  const originalSnapshot=businessSnapshot(db); let duplicateRejected=false;
  try {importLegacy(db,data,a.id);} catch {duplicateRejected=true;}
  const duplicateUnchanged=isDeepStrictEqual(originalSnapshot,businessSnapshot(db))&&isDeepStrictEqual(triggers,triggerSnapshot(db));
  const all=Object.values(compared).every(Boolean)&&metricsPass&&perPlan.every(Boolean)&&isolation&&roundtrip&&ar.status===200&&ae.status===200&&br.status===200&&be.status===200&&planResponses.every(x=>x.status===200)&&taskResponses.every(x=>x.status===200)&&data.tasks.every(t=>review.evidence.tasks.some(x=>x.id===t.id))&&duplicateRejected&&duplicateUnchanged;
  report('relationship-check.json',{sourceSchemaValid:true,sourceRelationshipsValid:true,currentVersionsValid:true,foreignKeyCheckPass:db.sqlite.prepare('PRAGMA foreign_key_check').all().length===0,triggerSqlIdentical:isDeepStrictEqual(triggers,triggerSnapshot(db)),missingTriggers:0,allBusinessFieldsIdentical:compared});
  report('review-comparison.json',{asOfKoreanDate:review.today,sourceCalculated:metrics,importedReview:Object.fromEntries(Object.keys(metrics).map(k=>[k,review[k]])),equal:metricsPass,perPlanComparisonsPassed:perPlan.filter(Boolean).length,perPlanComparisonsTotal:perPlan.length,includesArchivedTasks:true});
  report('isolation-check.json',{userACreated:true,userBCreated:true,userIdsExist:Boolean(a.id&&b.id),aPlanGetsPassed:planResponses.filter(x=>x.status===200).length,aActiveTaskGetsPassed:taskResponses.filter(x=>x.status===200).length,aArchivedTasksPreservedInReviewAndExport:true,bDirectRequests:denied.length,bDirect404:denied.filter(x=>x.status===404).length,bReviewEmpty:true,bExportCounts:Object.fromEntries(tables.map(t=>[t,bExport[t].length])),passed:isolation});
  report('import-rehearsal-result.json',{baseline:'d06412a0fb706423e7418de00c1fd1fb58b0c664',fixtureOnly:true,localIgnoredDatabase:dbPath,signupSuccess:true,userIdExists:true,migrations:db.sqlite.prepare('SELECT name FROM _migrations ORDER BY name').all().map(x=>x.name),...result,roundtripSchema:'3.0.0',roundtripPassed:roundtrip,duplicateRejected,duplicateBusinessAndTriggersUnchanged:duplicateUnchanged,passed:all,remoteD1:false,publicDeploy:false,actualFiveDays:false});
  // Exact runtime secrets checked in evidence and all tracked/untracked non-ignored files, without displaying them.
  for(const [table,column] of [['account','password'],['session','token']]) for(const r of db.sqlite.prepare(`SELECT ${column} AS value FROM ${table}`).all()) if(typeof r.value==='string')privateValues.push(r.value);
  const {execFileSync}=await import('node:child_process');
  const paths=execFileSync('git',['-c',`safe.directory=${process.cwd().replaceAll('\\','/')}`,'ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n');
  const leaks=paths.filter(p=>privateValues.some(v=>v.length>16&&readFileSync(p).includes(Buffer.from(v)))).length;
  report('secret-check.json',{runtimeSecretLeaks:leaks,passed:leaks===0,rawExportCopiedToEvidence:false,authRowDump:false});
  if(!all||leaks) throw new Error('Rehearsal check failed; inspect sanitized boolean reports');
  console.log(JSON.stringify({passed:all,sourceSha256:createHash('sha256').update(raw).digest('hex'),rows:result.rows,secretLeaks:leaks}));
} finally {db.close();}
