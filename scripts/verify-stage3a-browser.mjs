// Run unchanged historical assertions using temporary copies, so their screenshot
// destinations cannot overwrite committed Stage 2.1 evidence.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve('.data/stage3a/browser-tests');
// Preserve the tests' relative contract lookup in the isolated directory tree.
const contracts=resolve('.data/stage3a/contracts'); mkdirSync(contracts,{recursive:true});
for(const file of readdirSync('contracts').filter(f=>f.endsWith('.json'))) writeFileSync(join(contracts,file),readFileSync('contracts/'+file));
for(const group of ['e2e','auth-browser']) {
  const target=join(root,group); mkdirSync(target,{recursive:true});
  for(const file of readdirSync('tests/'+group).filter(f=>f.endsWith('.ts'))) {
    const original=readFileSync('tests/'+group+'/'+file,'utf8');
    writeFileSync(join(target,file),original.replaceAll('evidence/t07/stage2-1/browser/','evidence/t07/stage3a/browser/'));
  }
}
const config=resolve('.data/stage3a/playwright.config.ts');
writeFileSync(config,`import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.browser');
export default defineConfig({testDir:'./browser-tests',fullyParallel:false,workers:1,
reporter:[['list'],['json',{outputFile:resolve('evidence/t07/stage3a/browser-results.json')}]],
use:{baseURL:'http://127.0.0.1:3107',browserName:'chromium',headless:true,trace:'off',screenshot:'off',video:'off'},
webServer:{command:'node scripts/e2e-server.mjs',cwd:process.cwd(),url:'http://127.0.0.1:3107/api/health',reuseExistingServer:false,timeout:30000}});
`);
const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config',config],{stdio:'inherit'});
process.exitCode=result.status ?? 1;
