import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { redactEvidence } from './evidence-redact.mjs';
const base='https://localhost:8787',results=[];
function check(label,passed){results.push({label,passed:!!passed});if(!passed)throw new Error('Assertion failed: '+label);}
function call(path,body,ip='192.0.2.121',extra={}) {return new Promise((resolve,reject)=>{
 const req=https.request(base+path,{rejectUnauthorized:false,method:body===undefined?'GET':'POST',headers:{'cf-connecting-ip':ip,...extra,...(body===undefined?{}:{'Content-Type':'application/json',Origin:base})}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',()=>reject(new Error('Local HTTPS connection failed')));req.end(body===undefined?undefined:JSON.stringify(body));
});}
function securityHeaders(label,response) {check(label+' nosniff',response.headers['x-content-type-options']==='nosniff');check(label+' referrer',response.headers['referrer-policy']==='no-referrer');check(label+' CSP',response.headers['content-security-policy']?.includes("script-src 'self'"));check(label+' frame ancestors',response.headers['content-security-policy']?.includes("frame-ancestors 'none'"));check(label+' no-store',response.headers['cache-control']==='no-store');}
let browser;
try {
 const html=await call('/');check('HTML 200',html.status===200);securityHeaders('HTML',html);
 const js=html.text.match(/src="([^\"]+\.js)"/)?.[1],css=html.text.match(/href="([^\"]+\.css)"/)?.[1];check('bundled assets present',Boolean(js&&css));
 const javascript=await call(js);check('JS 200',javascript.status===200);securityHeaders('JS',javascript);
 const stylesheet=await call(css);check('CSS 200',stylesheet.status===200);securityHeaders('CSS',stylesheet);
 const plans=await call('/api/plans');check('unauthenticated API 401',plans.status===401);securityHeaders('API',plans);
 const deep=await call('/diary/help',undefined,'192.0.2.121',{'Sec-Fetch-Mode':'navigate',Accept:'text/html'});check('SPA deep link 200',deep.status===200&&deep.text.includes('<div id="root">'));securityHeaders('SPA',deep);
 const email=crypto.randomUUID()+'@example.invalid',password=randomBytes(24).toString('hex');
 const signup=await call('/api/auth/sign-up/email',{email,password,name:'  Local security fixture  '});check('signup trims name',signup.status===200&&JSON.parse(signup.text).user.name==='Local security fixture');
 const cookie=(signup.headers['set-cookie']??[]).map(c=>c.split(';')[0]).join('; ');
 const normal=await call('/api/auth/sign-in/email',{email,password});check('normal login succeeds',normal.status===200);
 const statuses=[];for(let i=0;i<11;i++)statuses.push((await call('/api/auth/sign-in/email',{email,password:randomBytes(24).toString('hex')},'192.0.2.122',{'x-forwarded-for':`198.51.100.${i+1}`})).status);
 check('10 failures followed by actual 429',statuses.slice(0,10).every(s=>s===401)&&statuses[10]===429);
 check('different trusted client can still log in',(await call('/api/auth/sign-in/email',{email,password},'192.0.2.123')).status===200);
 const missing=await call('/api/auth/sign-in/email',{email:'missing@example.invalid',password},'192.0.2.124'),wrong=await call('/api/auth/sign-in/email',{email,password:randomBytes(24).toString('hex')},'192.0.2.124');
 check('wrong/absent responses identical',missing.status===401&&wrong.status===401&&missing.text===wrong.text);
 for(const [label,name,pwd] of [['blank name','   ',password],['101 character name','x'.repeat(101),password],['short password','Name',randomBytes(8).toString('hex').slice(0,11)]]) {
  const response=await call('/api/auth/sign-up/email',{email:crypto.randomUUID()+'@example.invalid',password:pwd,name},'192.0.2.125');check('server refuses '+label,response.status>=400&&response.status<500);
 }
 const minimal=await call('/api/auth/sign-up/email',{email:crypto.randomUUID()+'@example.invalid',password:randomBytes(6).toString('hex'),name:'12 character password fixture'},'192.0.2.126');check('12 character password accepted',minimal.status===200);
 const sample=redactEvidence({environment:'temporary local fixture only',status:signup.status,body:JSON.parse(signup.text),headers:[{name:'Set-Cookie',value:signup.headers['set-cookie']?.join('; ')}]});
 check('sanitized token not retained',!JSON.stringify(sample).includes(JSON.parse(signup.text).token));writeFileSync('evidence/t07/stage2-1/auth-response-redacted.json',JSON.stringify(sample,null,2)+'\n');
 const exported=await call('/api/export',undefined,'192.0.2.121',{Cookie:cookie});const data=JSON.parse(exported.text);check('no auth/rate data in export',exported.status===200&&!['user','session','account','verification','rateLimit'].some(k=>k in data)&&!exported.text.includes(JSON.parse(signup.text).token));
 browser=await chromium.launch({headless:true,executablePath:'.browser/chromium-1243/chrome-win64/chrome.exe'});const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.name));
 await page.goto(base+'/diary/help');await page.getByRole('heading',{name:'로그인',exact:true}).waitFor();check('Worker SPA browser renders without script error',errors.length===0);
 await page.screenshot({path:'evidence/t07/stage2-1/browser/worker-deep-link.png'});await browser.close();browser=undefined;
 writeFileSync('evidence/t07/stage2-1/workerd-security-results.json',JSON.stringify({passed:true,environment:'HTTPS localhost workerd + local D1; production auth profile; no remote resources',loginThreshold:10,windowSeconds:60,checks:results},null,2)+'\n');
 console.log(JSON.stringify({passed:true,checks:results.length,loginStatuses:statuses}));
} catch(error) {writeFileSync('evidence/t07/stage2-1/workerd-security-results.json',JSON.stringify({passed:false,checks:results},null,2));console.error(error.message);process.exitCode=1;}finally{if(browser)await browser.close();}
