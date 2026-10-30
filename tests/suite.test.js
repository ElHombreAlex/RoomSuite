'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const http = require('node:http');

const port = 24000 + Math.floor(Math.random() * 20000);
const base = 'http://127.0.0.1:' + port;
let dir, server;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roomsuite-test-'));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, CLIPROOM_PORT:String(port), CLIPROOM_DATA:dir }, stdio:['ignore','pipe','pipe']
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('RoomSuite did not start.')), 10000);
    server.once('error', reject); server.once('exit', code => reject(new Error('Server exited: ' + code)));
    server.stdout.on('data', data => { if (String(data).includes('RoomSuite is running')) { clearTimeout(timeout); resolve(); } });
  });
});
after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  const relative = path.relative(os.tmpdir(), dir || '');
  if (dir && relative.startsWith('roomsuite-test-') && !relative.includes(path.sep)) await fs.rm(dir, { recursive:true, force:true });
});
test('launcher and all rooms are served by one server', async () => {
  for (const [route, title] of [['/','RoomSuite'],['/pixelroom/','Pixelroom'],['/cliproom/','Cliproom'],['/soundroom/','SoundRoom'],['/captureroom/','CaptureRoom'],['/vectorroom/','VectorRoom'],['/notesroom/','NotesRoom'],['/paintroom/','PaintRoom'],['/files/','Shared files']]) {
    const response = await fetch(base + route); assert.equal(response.status, 200, route); assert.match(await response.text(), new RegExp(title));
  }
  const wasm = await fetch(base + '/pixelroom/vendor/vision/ort-wasm-simd-threaded.wasm', { method:'HEAD' });
  assert.equal(wasm.status, 200); assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  const clipScript = await fetch(base + '/app.js'); assert.equal(clipScript.status, 200); assert.match(await clipScript.text(), /importRoomHandoff/);
});
test('handoff keeps same-origin upload protection and exposes only stored metadata', async () => {
  const headers = { Origin:base, 'X-Cliproom-Request':'1', 'X-File-Type':'audio/wav', 'X-File-Name':'voice.wav' };
  const denied = await fetch(base + '/api/assets', { method:'POST', headers:{ ...headers, Origin:'https://other.example' }, body:'audio' });
  assert.equal(denied.status, 403);
  const upload = await fetch(base + '/api/assets', { method:'POST', headers, body:'audio' });
  assert.equal(upload.status, 201); const asset = await upload.json();
  const metadata = await fetch(base + '/api/assets/' + asset.id + '/metadata'); assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), asset);
  assert.equal((await fetch(base + '/api/assets/not-an-id/metadata')).status, 404);
});
test('static routes reject encoded traversal and unapproved extensions', async () => {
  const result = await new Promise((resolve, reject) => {
    const req = http.get(base + '/soundroom/%2e%2e%5ccliproom%5cserver.js', response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); req.on('error', reject);
  });
  assert.equal(result, 404);
  assert.equal((await fetch(base + '/pixelroom/vendor/vision/lama.part1.bin.bak')).status, 404);
});
