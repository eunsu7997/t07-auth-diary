import { test as base, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
// Temporary accounts only; credentials stay in process memory, never traces/screenshots.
export const test = base.extend<{authenticated: void}>({
 request: async ({ context }, use) => { await use(context.request); },
 authenticated: [async ({ context, baseURL }, use) => {
  const response=await context.request.post(baseURL+'/api/auth/sign-up/email',{data:{email:crypto.randomUUID()+'@example.invalid',name:'Automated browser fixture',password:Array.from(randomBytes(24), b=>b.toString(16).padStart(2,'0')).join('')}});
  expect(response.ok()).toBe(true);await use();
 },{auto:true}],
});
export { expect };

