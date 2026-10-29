import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mcp = fileURLToPath(new URL('../server.mjs', import.meta.url));
const port = 24000 + Math.floor(Math.random() * 20000);
const base = 'http://127.0.0.1:' + port;
let temp, work, server, client;
function tone() {
  const rate = 48000, frames = rate * 2, b = Buffer.alloc(44 + frames * 2);
  b.write('RIFF',0); b.writeUInt32LE(b.length - 8,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(rate,24); b.writeUInt32LE(rate * 2,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(frames * 2,40);
  for (let i=0;i<frames;i++) b.writeInt16LE(Math.round(Math.sin(i * 440 * Math.PI * 2 / rate) * 10000),44+i*2);
  return b;
}
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments:args }, { timeout:180000 });
  if (response.isError) throw new Error(response.content?.map(item => item.text).join(' ') || 'Tool failed');
  return response.structuredContent || JSON.parse(response.content[0].text);
}
before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'roomsuite-mcp-test-')); work = path.join(temp,'workspace'); await fs.mkdir(work);
  await fs.writeFile(path.join(work,'tone.wav'), tone());
  await fs.copyFile(path.join(root,'PixelRoom','dist','sample.jpg'), path.join(work,'sample.jpg'));
  server = spawn(process.execPath, [path.join(root,'server.js')], { env:{ ...process.env, CLIPROOM_PORT:String(port), CLIPROOM_DATA:path.join(temp,'data') }, stdio:['ignore','pipe','pipe'] });
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('RoomSuite server did not start.')), 10000);
    server.once('error',reject); server.once('exit',code => reject(new Error('RoomSuite server exited: ' + code)));
    server.stdout.on('data', data => { if (String(data).includes('RoomSuite is running')) { clearTimeout(timer); resolve(); } });
  });
  const transport = new StdioClientTransport({ command:process.execPath, args:[mcp], env:{ ...process.env, ROOMSUITE_MCP_WORKSPACE:work, ROOMSUITE_MCP_URL:base }, stderr:'pipe' });
  client = new Client({ name:'roomsuite-integration-test', version:'1.0.0' }); await client.connect(transport);
});
after(async () => {
  if (client) await client.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit',resolve)); }
  const relative = path.relative(os.tmpdir(), temp || '');
  if (temp && relative.startsWith('roomsuite-mcp-test-') && !relative.includes(path.sep)) await fs.rm(temp, { recursive:true, force:true });
});
test('MCP discovers tools and advertises the workspace', async () => {
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  for (const name of ['roomsuite_info','pixelroom_edit','soundroom_edit','vectorroom_create','captureroom_record_scene','cliproom_render']) assert.ok(tools.includes(name),name);
  const info = await call('roomsuite_info'); assert.equal(info.workspace, await fs.realpath(work)); assert.equal(info.server_url,base);
});
test('VectorRoom creates a usable PNG from structured shapes and text', async () => {
  const result = await call('vectorroom_create', { output:'art.png', elements:[
    { type:'rect', x:100, y:100, width:500, height:300, fill_mode:'gradient', fill:'#6c4ed9', fill2:'#f1b6a8' },
    { type:'text', x:150, y:270, text:'RoomSuite', font_size:64, fill:'#ffffff' },
    { type:'path', points:[{x:100,y:450,out_x:250,out_y:300},{x:600,y:500,in_x:500,in_y:650}], stroke:'#221122', stroke_width:5 }
  ] });
  const png = await fs.readFile(result.path); assert.equal(png.subarray(1,4).toString(),'PNG'); assert.equal(png.readUInt32BE(16),1000); assert.equal(png.readUInt32BE(20),700);
});
test('PixelRoom edits and crops an image through the editor', async () => {
  const result = await call('pixelroom_edit', { input:'art.png', output:'cropped.png', brightness:15, crop:{x:100,y:100,width:400,height:300} });
  const png = await fs.readFile(result.path); const width=png.readUInt32BE(16), height=png.readUInt32BE(20);
  assert.ok(Math.abs(width-400) <= 2 && Math.abs(height-300) <= 2, 'crop dimensions: ' + width + 'x' + height);
});
test('PixelRoom runs the local subject model', { skip:process.env.ROOMSUITE_MCP_TEST_MODELS !== '1', timeout:180000 }, async () => {
  const result = await call('pixelroom_edit', { input:'sample.jpg', output:'cutout.png', remove_background:true });
  const png = await fs.readFile(result.path); assert.equal(png.subarray(1,4).toString(),'PNG'); assert.ok(result.bytes > 1000);
});
test('SoundRoom trims and fades audio to WAV', async () => {
  const result = await call('soundroom_edit', { input:'tone.wav', output:'edited.wav', trim:{start:0.25,end:1.25}, normalize:true, fade_in:0.1, fade_out:0.1 });
  const data = await fs.readFile(result.path); assert.equal(data.toString('ascii',0,4),'RIFF');
  assert.ok(result.duration_seconds > .95 && result.duration_seconds < 1.05); assert.equal(data.readInt16LE(44),0);
});
test('CaptureRoom records a prepared visual scene', async () => {
  const updates = [];
  const response = await client.callTool({ name:'captureroom_record_scene', arguments:{ output:'scene', image:'art.png', text:'Hello', duration:2 } }, { timeout:180000, onprogress:update => updates.push(update.progress) });
  if (response.isError) throw new Error(response.content[0].text);
  const result = response.structuredContent || JSON.parse(response.content[0].text);
  assert.ok(result.bytes > 1000); assert.match(result.path, /\.(webm|mp4)$/);
  assert.equal(updates[0],0); assert.equal(updates[updates.length - 1],100); assert.ok(updates.every((n,i) => i === 0 || n > updates[i-1]));
});
test('Cliproom renders a timeline and saves an editable project', async () => {
  const result = await call('cliproom_render', {
    output:'video', name:'MCP test', media:[{input:'cropped.png',duration:1.5},{input:'edited.wav',start:0}],
    titles:[{text:'Made with RoomSuite',start:0,end:1}], save_project:true
  });
  assert.ok(result.bytes > 1000); assert.ok(result.project.id); assert.equal(result.project.revision,1);
  const project = await (await fetch(base + '/api/projects/' + result.project.id)).json();
  assert.equal(project.state.name,'MCP test'); assert.equal(project.state.titles[0].text,'Made with RoomSuite'); assert.equal(project.state.assets.length,2);
});
test('workspace containment and no-overwrite behavior are enforced', async () => {
  await assert.rejects(call('soundroom_edit',{ input:'../outside.wav',output:'no.wav' }),/inside the configured MCP workspace/);
  await assert.rejects(call('vectorroom_create',{ output:'art.png',elements:[{type:'rect',x:0,y:0,width:10,height:10}] }),/already exists/);
});
test('two independent tool calls can run concurrently', async () => {
  const one = { output:'one.svg', elements:[{type:'rect',x:0,y:0,width:30,height:30}] };
  const two = { output:'two.svg', elements:[{type:'ellipse',x:0,y:0,width:40,height:40}] };
  const results = await Promise.all([call('vectorroom_create',one),call('vectorroom_create',two)]);
  assert.equal(results.length,2); assert.ok((await fs.readFile(results[0].path,'utf8')).includes('<rect')); assert.ok((await fs.readFile(results[1].path,'utf8')).includes('<ellipse'));
});
test('cancelling a recording stops the job before an output is created', async () => {
  const controller = new AbortController();
  const pending = client.callTool({ name:'captureroom_record_scene', arguments:{ output:'cancelled', text:'Cancel me', duration:8 } }, { signal:controller.signal, timeout:30000 });
  setTimeout(() => controller.abort('cancelled by test'), 1800);
  await assert.rejects(pending);
  await new Promise(resolve => setTimeout(resolve, 500));
  const entries = await fs.readdir(work); assert.ok(!entries.some(name => name.startsWith('cancelled.')));
  assert.ok((await call('roomsuite_info')).rooms.includes('captureroom_record_scene'));
});
