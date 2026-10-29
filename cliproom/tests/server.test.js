'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');

const port = 24000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
let dir, server, mediaId;
const writeHeaders = { Origin: base, 'X-Cliproom-Request': '1' };
async function call(url, options = {}) {
  const response = await fetch(base + url, options);
  return { response, body: await response.json() };
}
async function statusWithHost(host) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + '/api/health', { headers: { Host: host } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
  });
}
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cliproom-test-'));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, CLIPROOM_PORT: String(port), CLIPROOM_DATA: dir, CLIPROOM_ALLOWED_HOSTS: 'studio.example:8443' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start.')), 10000);
    server.once('error', reject);
    server.once('exit', code => reject(new Error(`Server exited: ${code}`)));
    server.stdout.on('data', data => { if (data.toString().includes('Cliproom is running')) { clearTimeout(timer); resolve(); } });
  });
});
after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  // Only remove the directory created by this test, and only below the temp root.
  const relative = path.relative(os.tmpdir(), dir || '');
  if (dir && relative.startsWith('cliproom-test-') && !relative.includes(path.sep)) await fs.rm(dir, { recursive: true, force: true });
});

test('same-origin uploads, media ranges and project conflicts', async () => {
  assert.equal(await statusWithHost('unlisted.example'), 403);
  assert.equal(await statusWithHost('studio.example:8443'), 200);
  const forbidden = await call('/api/assets', { method: 'POST', headers: { ...writeHeaders, Origin: 'https://other.example', 'X-File-Type': 'image/png' }, body: 'not-allowed' });
  assert.equal(forbidden.response.status, 403);
  const unsupported = await call('/api/assets', { method: 'POST', headers: { ...writeHeaders, 'X-File-Type': 'image/svg+xml' }, body: '<svg/>' });
  assert.equal(unsupported.response.status, 415);
  const upload = await call('/api/assets', { method: 'POST', headers: { ...writeHeaders, 'X-File-Type': 'image/png', 'X-File-Name': 'example.png' }, body: '0123456789' });
  assert.equal(upload.response.status, 201); mediaId = upload.body.id;
  const range = await fetch(base + '/api/assets/' + mediaId, { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await range.text(), '2345');

  const id = crypto.randomUUID();
  const state = { name: 'Story', assets: [{ id: mediaId }], clips: [], titles: [] };
  const save = revision => call('/api/projects/' + id, { method: 'PUT', headers: { ...writeHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision: revision, state }) });
  assert.equal((await save(0)).body.revision, 1);
  const concurrent = await Promise.all([save(1), save(1)]);
  assert.deepEqual(concurrent.map(result => result.response.status).sort(), [200, 409]);
  const reopened = await call('/api/projects/' + id);
  assert.equal(reopened.body.revision, 2); assert.equal(reopened.body.state.assets[0].id, mediaId);
  assert.equal((await call('/api/projects')).body.projects[0].name, 'Story');
  const missing = await call('/api/projects/' + crypto.randomUUID(), { method: 'PUT', headers: { ...writeHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision: 0, state: { name: 'Broken', assets: [{ id: crypto.randomUUID() }] } }) });
  assert.equal(missing.response.status, 400);
});

test('project deletion checks origin and revision without deleting shared media', async () => {
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const state = { name:'Shared media', assets:[{ id:mediaId }], clips:[], titles:[] };
  const save = (id, revision) => call('/api/projects/' + id, { method:'PUT', headers:{ ...writeHeaders, 'Content-Type':'application/json' }, body:JSON.stringify({ baseRevision:revision, state }) });
  const remove = (id, revision, headers = writeHeaders) => call('/api/projects/' + id, { method:'DELETE', headers:{ ...headers, 'Content-Type':'application/json' }, body:JSON.stringify({ baseRevision:revision }) });
  assert.equal((await save(first,0)).response.status,200); assert.equal((await save(second,0)).response.status,200);
  assert.equal((await save(first,1)).body.revision,2);
  assert.equal((await remove(first,2,{ ...writeHeaders, Origin:'https://other.invalid' })).response.status,403);
  assert.equal((await remove(first,0)).response.status,400);
  assert.equal((await remove(first,1)).response.status,409);
  assert.equal((await call('/api/projects/' + first)).body.revision,2);
  const deleted = await remove(first,2); assert.equal(deleted.response.status,200); assert.equal(deleted.body.deleted,true);
  assert.equal((await call('/api/projects/' + first)).response.status,404);
  assert.equal((await remove(first,2)).response.status,404);
  assert.equal((await save(first,2)).response.status,409);
  assert.equal((await call('/api/projects/' + second)).response.status,200);
  assert.equal((await fetch(base + '/api/assets/' + mediaId)).status,200);
  const concurrentId = crypto.randomUUID(); assert.equal((await save(concurrentId,0)).response.status,200);
  const [update, deletion] = await Promise.all([save(concurrentId,1), remove(concurrentId,1)]);
  assert.deepEqual([update.response.status,deletion.response.status].sort(),[200,409]);
  const outcome = await call('/api/projects/' + concurrentId);
  if (update.response.status === 200) assert.equal(outcome.body.revision,2); else assert.equal(outcome.response.status,404);
});
