import './block-remote.mjs';
// Production is read-only here. Users create their own real records.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.browser');
const { chromium, expect } = await import('@playwright/test');
const url = 'https://aleph-t06-pds-diary.aleph-t04-eunsu.workers.dev';
const tables = ['plans', 'plan_versions', 'tasks', 'tags', 'task_tags', 'execution_logs'];
const remote = JSON.parse(await readFile('evidence/final-d1-snapshot.json', 'utf8'));
assert(remote.every(r => r.success));
const rows = Object.fromEntries(tables.map((t, i) => [t, remote[i].results]));
const before = JSON.parse(await readFile('evidence/final-d1-before-supplement.json', 'utf8'));
const originalBefore = before[0].results[0];
const originalNow = rows.plans.find(p => p.id === originalBefore.id);
assert(originalNow); assert.equal(originalNow.created_at, originalBefore.created_at);
assert.equal(originalNow.current_version, 2);
assert.deepEqual(rows.plan_versions.find(v => v.plan_id === originalBefore.id && v.version === 1), before[1].results[0]);
assert(rows.plan_versions.some(v => v.plan_id === originalBefore.id && v.version === 2));
const preservation = {};
for (const [i,table] of tables.entries()) {
  preservation[table] = before[i].results.every(old => rows[table].some(current => JSON.stringify(current) === JSON.stringify(old)));
}
const schema = JSON.parse(await readFile('contracts/pds-schema-v2.json', 'utf8'));
const db = new DatabaseSync(':memory:');
db.exec(await readFile('migrations/0001_initial.sql', 'utf8'));
db.exec(await readFile('migrations/0002_execution_guards.sql', 'utf8'));
const normalizeSQL = sql => sql.replace(/\s+/g, ' ').trim();
const localStructure = db.prepare('SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name').all();
for (const local of localStructure) {
  const actual = remote[6].results.find(r => r.name === local.name);
  assert(actual, local.name);
  assert.equal(actual.type, local.type);
  assert.equal(normalizeSQL(actual.sql), normalizeSQL(local.sql), local.name);
}
assert.deepEqual(remote[7].results, []);
for (const [i, table] of tables.entries()) {
  const cols = remote[8 + i].results;
  assert.deepEqual(cols, db.prepare(`PRAGMA table_info(${table})`).all().map(r => ({ ...r })));
  assert.deepEqual(remote[14 + i].results, db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(r => ({ ...r })));
  const meta = schema['x-database'][table];
  assert.deepEqual(cols.map(r => r.name).sort(), Object.keys(schema.$defs[table].properties).sort());
  assert.deepEqual(cols.filter(r => r.pk).sort((a,b) => a.pk-b.pk).map(r => r.name), meta.primary_key);
  assert.deepEqual(cols.filter(r => !r.notnull).map(r => r.name).sort(), [...meta.nullable].sort());
  assert.deepEqual(cols.filter(r => r.type === 'INTEGER').map(r => r.name).sort(), [...meta.integer_columns].sort());
  assert(cols.every(r => ['INTEGER', 'TEXT'].includes(r.type)));
  const fks = remote[14+i].results.map(r => `${r.from}:${r.table}:${r.to}`).sort();
  assert.deepEqual(fks, meta.foreign_keys.map(r => `${r.column}:${r.table}:${r.target}`).sort());
  const unique = db.prepare(`PRAGMA index_list(${table})`).all().filter(r => r.unique && r.origin === 'u').map(r => db.prepare(`PRAGMA index_info(${r.name})`).all().map(c => c.name).join(',')).sort();
  assert.deepEqual(unique, meta.unique.map(r => r.join(',')).sort());
}
assert.deepEqual(remote[6].results.filter(r => r.type === 'trigger').map(r => r.name).sort(), [...schema['x-triggers']].sort());
const partial = schema['x-database'].execution_logs.partial_unique[0];
assert(remote[6].results.find(r => r.name === partial.name).sql.includes(partial.predicate));
db.close();
const browser = await chromium.launch();
const browserChecks = [];
let exportData, review;
try {
  for (let i=0; i<2; i++) {
    const context = await browser.newContext();
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    assert.equal((await page.goto(url)).status(), 200);
    await expect(page.getByRole('heading', { name: '플랜두씨 다이어리', exact: true })).toBeVisible();
    await expect(page.getByTestId('metric-plans').locator('strong')).toHaveText(String(rows.plans.length));
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    const health = await (await context.request.get(`${url}/api/health`)).json();
    assert.equal(health.storage, 'cloudflare-d1');
    const data = await (await context.request.get(`${url}/api/export`)).json();
    for (const table of tables) assert.deepEqual(data[table], rows[table]);
    review = await (await context.request.get(`${url}/api/review`)).json();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date(review.as_of));
    const kst = value => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
    const sum = (rs,key) => rs.reduce((n,r) => n + r[key],0);
    const closed = rows.execution_logs.filter(r => r.ended_at !== null);
    const estimated = sum(rows.tasks,'estimated_seconds'), actual = sum(closed,'actual_seconds');
    const computed = {plan_count: rows.plans.length, completed_count: rows.tasks.filter(r=>r.status==='completed').length, delayed_count: rows.tasks.filter(r=>r.due_date && (r.status==='completed' ? kst(r.completed_at) : today)>r.due_date).length, task_estimated_seconds: estimated, actual_seconds: actual, difference_seconds: actual-estimated, plan_estimated_seconds: rows.plans.reduce((n,p)=>n+rows.plan_versions.find(v=>v.plan_id===p.id && v.version===p.current_version).estimated_seconds,0)};
    for (const [key,value] of Object.entries(computed)) assert.equal(review[key],value,key);
    await expect(page.getByTestId('metric-completed').locator('strong')).toHaveText(String(computed.completed_count));
    await expect(page.getByTestId('metric-estimated').locator('strong')).toContainText(`${estimated}초`);
    await expect(page.getByTestId('metric-actual').locator('strong')).toContainText(`${actual}초`);
    await expect(page.getByTestId('metric-difference').locator('strong')).toContainText(`${actual-estimated}초`);
    if (i === 0) {
      const originalPlan = rows.plans.find(p => p.id === before[0].results[0].id);
      assert(originalPlan);
      const latestVersion = rows.plan_versions.find(v => v.plan_id === originalPlan.id && v.version === originalPlan.current_version);
      await page.locator('.plan-list button').filter({ hasText: latestVersion.title }).click();
      await page.locator('.history summary').click();
      for (const version of rows.plan_versions.filter(v => v.plan_id === originalPlan.id)) {
        await expect(page.getByTestId(`version-${version.version}`)).toContainText(version.title);
        await expect(page.getByTestId(`version-${version.version}`)).toContainText(version.success_criteria);
      }
      await page.screenshot({path:'evidence/final-public-history.png',fullPage:true});
      for (const copy of rows.tasks.filter(t => t.copied_from_task_id)) {
        const copiedPlan = rows.plans.find(p => p.id === copy.plan_id);
        const copiedVersion = rows.plan_versions.find(v => v.plan_id === copy.plan_id && v.version === copiedPlan.current_version);
        await page.locator('.plan-list button').filter({ hasText: copiedVersion.title }).click();
        const card = page.getByTestId('task-card').filter({ hasText: copy.id });
        await expect(card).toContainText(copy.copied_from_task_id);
        const logsResponse = await context.request.get(`${url}/api/tasks/${copy.id}/executions`);
        assert.deepEqual(await logsResponse.json(), []);
        await page.screenshot({path:'evidence/final-public-copy.png',fullPage:true});
      }
      const pending = page.waitForEvent('download');
      await page.getByRole('button', {name:'전체 JSON 다운로드'}).click();
      const download = await pending; assert.equal(download.suggestedFilename(),'t06-diary.json');
      exportData = JSON.parse(await readFile(await download.path(),'utf8'));
      const ajv = new Ajv2020({strict:false,allErrors:true}); addFormats(ajv);
      const validate = ajv.compile(schema); assert(validate(exportData),JSON.stringify(validate.errors));
      for (const table of tables) { assert.deepEqual(exportData[table],rows[table]); assert.equal(exportData.export_metadata.table_counts[table],rows[table].length); }
      await writeFile('evidence/final-public-export.json',JSON.stringify(exportData,null,2)+'\n');
      await page.screenshot({path:'evidence/final-public-desktop.png',fullPage:true});
    }
    await page.reload();
    await expect(page.getByTestId('metric-plans').locator('strong')).toHaveText(String(rows.plans.length));
    for (const t of tables) assert.deepEqual((await (await context.request.get(`${url}/api/export`)).json())[t],rows[t]);
    assert.deepEqual(errors,[]); browserChecks.push(`context ${i+1}: anonymous, actual DB, reload, localStorage empty, no JS errors`);
    await context.close();
  }
} finally { await browser.close(); }
for (const log of rows.execution_logs) {
  assert(rows.tasks.some(t=>t.id===log.task_id));
  if(log.ended_at) assert.equal(log.actual_seconds,Math.floor((Date.parse(log.ended_at)-Date.parse(log.started_at))/1000));
  assert.equal(log.estimated_seconds_at_start,rows.tasks.find(t=>t.id===log.task_id).estimated_seconds);
}
const linux = rows.tasks.find(t=>t.content==='Linux 명령어 복습' && !t.copied_from_task_id);
const linuxLogs = rows.execution_logs.filter(l=>l.task_id===linux?.id).sort((a,b)=>a.started_at.localeCompare(b.started_at));
assert(linuxLogs.length>=2); assert.notEqual(linuxLogs[0].id,linuxLogs[1].id); assert(linuxLogs[0].ended_at<=linuxLogs[1].started_at);
const copies = rows.tasks.filter(t=>t.copied_from_task_id);
assert(copies.length > 0);
for(const table of ['plan_versions','tasks','tags','task_tags','execution_logs']) assert(preservation[table], `prior ${table} rows changed`);
for(const copy of copies) {
  const original=rows.tasks.find(t=>t.id===copy.copied_from_task_id); assert(original);
  assert.notEqual(copy.id,original.id); assert.notEqual(copy.plan_id,original.plan_id);
  for(const k of ['content','priority','estimated_seconds']) assert.equal(copy[k],original[k]);
  assert(!rows.execution_logs.some(l=>l.task_id===copy.id));
  const tags=id=>rows.task_tags.filter(t=>t.task_id===id).map(t=>t.tag_id).sort(); assert.deepEqual(tags(copy.id),tags(original.id));
}
const sensitivePattern=/(?:-----BEGIN .*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+)/i;
assert(!sensitivePattern.test(JSON.stringify(rows)), 'potential sensitive record; review without printing');
const userDownload = JSON.parse(await readFile('C:/Users/User/Downloads/t06-diary.json','utf8'));
const downloadAjv = new Ajv2020({strict:false,allErrors:true}); addFormats(downloadAjv);
const userValidate = downloadAjv.compile(schema); assert(userValidate(userDownload), JSON.stringify(userValidate.errors));
for(const table of tables) {
  const canonical = records => [...records].map(r => JSON.stringify(r)).sort();
  assert.deepEqual(canonical(userDownload[table]), canonical(rows[table]), `user downloaded ${table}`);
}
for(const task of rows.tasks) { assert(rows.plans.some(p=>p.id===task.plan_id)); if(task.copied_from_task_id) assert(rows.tasks.some(t=>t.id===task.copied_from_task_id)); }
for(const relation of rows.task_tags) { assert(rows.tasks.some(t=>t.id===relation.task_id)); assert(rows.tags.some(t=>t.id===relation.tag_id)); }
const results={verified_at:new Date().toISOString(),url,counts:Object.fromEntries(tables.map(t=>[t,rows[t].length])),completed_tasks:rows.tasks.filter(t=>t.status==='completed').length,closed_executions:rows.execution_logs.filter(l=>l.ended_at).length,review,linux_logs:linuxLogs,copy_count:copies.length,copies,original_plan_id:originalNow.id,original_plan_version:originalNow.current_version,original_version_preserved:true,user_download_matches_d1:true,history_plans:rows.plans.filter(p=>p.current_version>1).map(p=>p.id),schema_matches_d1:true,browserChecks,preservation,history_screen_verified:true,sensitive_scan:'no credential/contact patterns; free text manually review',pending:[]};
if(!results.history_plans.length) results.pending.push('No edited plan: original exists, stable ID across edit cannot be observed in production.');
if(!copies.length) results.pending.push('No copied task: production copy/new IDs/source relation/no copied executions cannot be observed.');
await writeFile('evidence/final-public-verification.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({counts:results.counts,completed_tasks:results.completed_tasks,closed_executions:results.closed_executions,copy_count:copies.length,pending:results.pending},null,2));
