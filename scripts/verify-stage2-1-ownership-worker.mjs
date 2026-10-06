// Loopback HTTPS + local D1 only. No passwords, cookie/token values or auth rows are serialized.
import https from 'node:https';
import { randomBytes, createHash } from 'node:crypto';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const base='https://localhost:8787';const results=[];
function check(label,pass){results.push({label,passed:!!pass});if(!pass)throw new Error('Local Worker assertion failed: '+label);}
function call(path,method='GET',body,cookie,headers={}) {return new Promise((resolve,reject)=>{
 const req=https.request(base+'/api'+path,{rejectUnauthorized:false,method,headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json',Origin:base}),...(cookie?{Cookie:cookie}:{})}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,data:text?JSON.parse(text):null}));});
 req.on('error',()=>reject(new Error('Local Worker connection failed')));req.end(body===undefined?undefined:JSON.stringify(body));
});}
let storage;
for(const file of readdirSync('.wrangler/state/v3/d1',{recursive:true}).filter(f=>String(f).endsWith('.sqlite')&&!String(f).endsWith('metadata.sqlite'))) {
 const db=new DatabaseSync(join('.wrangler/state/v3/d1',String(file)),{readOnly:true});if(db.prepare("SELECT name FROM sqlite_master WHERE name='plans'").get())storage=db;else db.close();
}
if(!storage)throw new Error('Local D1 required');
const tables=['plans','plan_versions','tasks','tags','task_tags','execution_logs'];
const fingerprint=()=>createHash('sha256').update(JSON.stringify(tables.map(t=>storage.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))).digest('hex');
const planInput={title:'Temporary local D1 fixture',period_start:'2026-10-01',period_end:'2026-10-09',success_criteria:'Automated tests only',estimated_seconds:100};
const taskInput={content:'Temporary local D1 task',priority:'low',due_date:null,estimated_seconds:60,tags:['학습']};
async function fixture(n){
 const signup=await call('/auth/sign-up/email','POST',{email:crypto.randomUUID()+'@example.invalid',name:'Temporary Worker fixture',password:randomBytes(24).toString('hex')});check('fixture signup '+n,signup.status===200);
 const cookies=signup.headers['set-cookie']??[];check('HTTPS cookie security '+n,cookies.some(c=>/HttpOnly/i.test(c)&&/Secure/i.test(c)&&/SameSite=Lax/i.test(c)));
 const cookie=cookies.map(c=>c.split(';')[0]).join('; '),userId=signup.data.user.id;
 const api=(p,m='GET',b,h)=>call(p,m,b,cookie,h);
 const plan=(await api('/plans','POST',{...planInput,estimated_seconds:100*n})).data;
 const completed=(await api(`/plans/${plan.id}/tasks`,'POST',{...taskInput,estimated_seconds:60*n})).data;
 const start=(await api(`/tasks/${completed.id}/start`,'POST',{request_id:crypto.randomUUID()})).data;
 const closed=(await api(`/tasks/${completed.id}/executions/${start.id}/finish`,'POST',{request_id:crypto.randomUUID()})).data;
 const active=(await api(`/plans/${plan.id}/tasks`,'POST',{...taskInput,estimated_seconds:120*n})).data;
 const open=(await api(`/tasks/${active.id}/start`,'POST',{request_id:crypto.randomUUID()})).data;
 return {api,cookie,userId,plan,completed,active,open,closed};
}
try {
 check('anonymous 401',(await call('/plans')).status===401);
 const pair=[await fixture(1),await fixture(3)];
 for(const [index,label] of [[0,'A -> B'],[1,'B -> A']]) {
 const me=pair[index],other=pair[1-index],copy={plan:planInput,tasks:[{task_id:other.completed.id,due_date:null}]};
 const requests=[
 ['plan GET',`/plans/${other.plan.id}`],['plan PUT',`/plans/${other.plan.id}`,'PUT',{...planInput,expected_version:1}],
 ['versions',`/plans/${other.plan.id}/versions`],['task list',`/plans/${other.plan.id}/tasks`],['task POST',`/plans/${other.plan.id}/tasks`,'POST',taskInput],
 ['task GET',`/tasks/${other.active.id}`],['task PUT',`/tasks/${other.active.id}`,'PUT',taskInput],['task DELETE',`/tasks/${other.completed.id}`,'DELETE'],
 ['task executions',`/tasks/${other.active.id}/executions`],['plan executions',`/plans/${other.plan.id}/executions`],
 ['start',`/tasks/${other.active.id}/start`,'POST',{request_id:crypto.randomUUID()}],['finish',`/tasks/${other.active.id}/executions/${other.open.id}/finish`,'POST',{request_id:crypto.randomUUID()}],
 ['reopen',`/tasks/${other.completed.id}/reopen`,'POST',{}],['selected review',`/review?plan_id=${other.plan.id}`],['copy',`/plans/${other.plan.id}/copy-completed`,'POST',copy],
 ['mixed copy',`/plans/${me.plan.id}/copy-completed`,'POST',{...copy,tasks:[{task_id:me.completed.id,due_date:null},...copy.tasks]}],
 ['mixed finish',`/tasks/${me.active.id}/executions/${other.open.id}/finish`,'POST',{request_id:crypto.randomUUID()}],
 ];
 for(const [name,path,method='GET',body] of requests) {const before=fingerprint(),res=await me.api(path,method,body);check(label+' '+name,res.status===404&&fingerprint()===before&&!res.text.includes(other.plan.id)&&!res.text.includes(other.open.id));}
 for(const path of ['/plans','/review','/export']) {const before=fingerprint(),res=await me.api(path);check(label+' isolated '+path,res.status===200&&fingerprint()===before&&![other.plan.id,other.active.id,other.completed.tags[0].id].some(id=>res.text.includes(id)));
 if(path==='/review')check(label+' review sums',res.data.plan_estimated_seconds===100*(index===0?1:3)&&res.data.task_estimated_seconds===180*(index===0?1:3)&&res.data.completed_count===1);
 if(path==='/export')check(label+' no auth export',!Object.keys(res.data).some(k=>['user','session','account','verification'].includes(k))&&!/password|token|credential|secret/i.test(res.text));
 }
 const before=fingerprint();check(label+' forged body',(await me.api('/plans','POST',{...planInput,owner_user_id:other.userId})).status===400&&fingerprint()===before);check(label+' forged header',(await me.api('/plans','GET',undefined,{'X-User-ID':other.userId})).status===400&&fingerprint()===before);
 const genericStart=await me.api(`/tasks/${me.active.id}/start`,'POST',{request_id:other.open.start_request_id});
 check(label+' generic start conflict',genericStart.status===409&&genericStart.data.error==='요청을 처리할 수 없습니다. 새 요청 ID로 다시 시도하세요.'&&fingerprint()===before);
 const genericFinish=await me.api(`/tasks/${me.active.id}/executions/${me.open.id}/finish`,'POST',{request_id:other.closed.finish_request_id});
 check(label+' generic finish conflict',genericFinish.status===409&&genericFinish.data.error==='요청을 처리할 수 없습니다. 새 요청 ID로 다시 시도하세요.'&&fingerprint()===before);
 check(label+' finish request collision',(await me.api(`/tasks/${me.active.id}/executions/${me.open.id}/finish`,'POST',{request_id:other.closed.finish_request_id})).status===409&&fingerprint()===before);
 const missing=await me.api('/plans/missing'),foreign=await me.api(`/plans/${other.plan.id}`);check(label+' equal missing/foreign',missing.status===foreign.status&&missing.text===foreign.text);
 }
 check('same tag name separate IDs',pair[0].completed.tags[0].id!==pair[1].completed.tags[0].id);
 const logout=await pair[0].api('/auth/sign-out','POST',{});check('logout',logout.status===200);check('old session blocked',(await pair[0].api('/plans')).status===401);
 writeFileSync('evidence/t07/stage2-1/worker-results.json',JSON.stringify({environment:'loopback HTTPS workerd + local D1; temporary fixtures only',passed:true,checks:results},null,2)+'\n');
 console.log(JSON.stringify({passed:true,checks:results.length,remoteD1:false}));
} catch(error){writeFileSync('evidence/t07/stage2-1/worker-results.json',JSON.stringify({passed:false,checks:results},null,2));console.error(error.message);process.exitCode=1;}finally{storage.close();}
