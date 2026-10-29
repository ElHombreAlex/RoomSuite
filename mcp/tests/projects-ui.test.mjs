import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import timeline from '../../cliproom/public/timeline.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const port = 24000 + Math.floor(Math.random() * 20000), base = 'http://127.0.0.1:' + port;
let directory, server, browser, context;
const first = crypto.randomUUID(), second = crypto.randomUUID();
const makeState = name => ({ ...timeline.empty(() => crypto.randomUUID()), name });
const state1 = makeState('First <project>'), state2 = makeState('Second project');
async function save(id, state, baseRevision) {
  return fetch(base + '/api/projects/' + id, { method:'PUT', headers:{ Origin:base, 'X-Cliproom-Request':'1', 'Content-Type':'application/json' }, body:JSON.stringify({baseRevision,state}) });
}
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'roomsuite-project-ui-'));
  server = spawn(process.execPath,[path.join(root,'server.js')],{ env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:directory},stdio:['ignore','pipe','pipe'] });
  await new Promise((resolve,reject) => {
    const timer=setTimeout(() => reject(new Error('RoomSuite did not start.')),10000);
    server.once('error',reject); server.once('exit',code => reject(new Error('RoomSuite exited: ' + code)));
    server.stdout.on('data',data => { if (String(data).includes('RoomSuite is running')) { clearTimeout(timer); resolve(); } });
  });
  assert.equal((await save(first,state1,0)).status,200); assert.equal((await save(second,state2,0)).status,200);
  browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH ? {executablePath:process.env.ROOMSUITE_BROWSER_PATH} : {})});
  context=await browser.newContext({viewport:{width:1440,height:1000}});
});
after(async () => {
  if (context) await context.close(); if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit',resolve)); }
  const relative=path.relative(os.tmpdir(),directory || '');
  if (directory && relative.startsWith('roomsuite-project-ui-') && !relative.includes(path.sep)) await fs.rm(directory,{recursive:true,force:true});
});

test('Your space opens projects and supports safe open and delete', async () => {
  const home=await context.newPage(); await home.goto(base + '/');
  const [page]=await Promise.all([context.waitForEvent('page'),home.getByRole('link',{name:/Your projects/}).click()]);
  await page.waitForLoadState();
  await page.waitForFunction(() => document.querySelector('#projectsDialog').open);
  assert.equal(await page.locator('.project-item').count(),2);
  await page.getByRole('button',{name:'Open First <project>'}).click();
  await page.waitForFunction(() => document.querySelector('#projectName').value === 'First <project>');
  assert.equal(await page.locator('#projectName').inputValue(),'First <project>');
  assert.equal(await page.locator('#projectsDialog').evaluate(dialog => dialog.open),false);

  await page.locator('#openBtn').click();
  page.once('dialog',dialog => dialog.dismiss());
  await page.getByRole('button',{name:'Delete Second project'}).click();
  assert.equal((await fetch(base + '/api/projects/' + second)).status,200);

  assert.equal((await save(second,state2,1)).status,200);
  page.once('dialog',dialog => dialog.accept());
  await page.getByRole('button',{name:'Delete Second project'}).click();
  await page.waitForFunction(() => document.querySelector('#projectsStatus').textContent.includes('changed on another device'));
  assert.equal((await fetch(base + '/api/projects/' + second)).status,200);
  page.once('dialog',dialog => dialog.accept());
  await page.getByRole('button',{name:'Delete Second project'}).click();
  await page.waitForFunction(() => document.querySelectorAll('.project-item').length === 1);
  assert.equal((await fetch(base + '/api/projects/' + second)).status,404);

  page.once('dialog',dialog => dialog.accept());
  await page.getByRole('button',{name:'Delete First <project>'}).click();
  await page.waitForFunction(() => document.querySelector('#projectsStatus').textContent.includes('saved as a new project'));
  assert.match(await page.locator('#projectList').textContent(),/No saved projects yet/);
  const openState=await page.evaluate(() => ({ id:projectId, revision, dirty, name:state.name }));
  assert.notEqual(openState.id,first); assert.equal(openState.revision,0); assert.equal(openState.dirty,true); assert.equal(openState.name,'First <project>');
  assert.equal((await fetch(base + '/api/projects/' + first)).status,404);
  await page.locator('#projectsDialog .close-dialog').first().click();
  await page.locator('#saveBtn').click(); await page.waitForFunction(() => revision === 1);
  assert.equal((await fetch(base + '/api/projects/' + openState.id)).status,200);
});
