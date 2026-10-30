import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mcp = fileURLToPath(new URL('../server.mjs', import.meta.url));
const port = 24000 + Math.floor(Math.random() * 20000);
const base = 'http://127.0.0.1:' + port;
let temp, work, server, client, savedProjectId;
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
  for (const name of ['roomsuite_info','roomsuite_list_files','roomsuite_media_info','pixelroom_edit','pixelroom_inpaint','soundroom_edit','vectorroom_create','captureroom_record_scene','cliproom_import_media','cliproom_list_projects','cliproom_get_project','cliproom_save_project','cliproom_render','cliproom_render_project']) assert.ok(tools.includes(name),name);
  const info = await call('roomsuite_info'); assert.equal(info.workspace, await fs.realpath(work)); assert.equal(info.server_url,base);
});
test('VectorRoom creates a usable PNG from structured shapes and text', async () => {
  const result = await call('vectorroom_create', { output:'art.png', elements:[
    { type:'rect', x:100, y:100, width:500, height:300, fill_mode:'gradient', fill:'#6c4ed9', fill2:'#f1b6a8' },
    { type:'text', x:150, y:270, text:'RoomSuite', font_size:64, fill:'#ffffff' },
    { type:'path', points:[{x:100,y:450,out_x:250,out_y:300},{x:600,y:500,in_x:500,in_y:650}], stroke:'#221122', stroke_width:5 }
  ] });
  const png = await fs.readFile(result.path); assert.equal(png.subarray(1,4).toString(),'PNG'); assert.equal(png.readUInt32BE(16),1000); assert.equal(png.readUInt32BE(20),700);
  const editable=await call('vectorroom_create',{output:'opacity.vectorroom',elements:[{type:'rect',x:10,y:10,width:100,height:100,opacity:.35}]});assert.equal(JSON.parse(await fs.readFile(editable.path,'utf8')).objects[0].opacity,.35);
});
test('PixelRoom edits and crops an image through the editor', async () => {
  const result = await call('pixelroom_edit', { input:'art.png', output:'cropped.png', brightness:15, crop:{x:100,y:100,width:400,height:300} });
  const png = await fs.readFile(result.path); const width=png.readUInt32BE(16), height=png.readUInt32BE(20);
  assert.ok(Math.abs(width-400) <= 2 && Math.abs(height-300) <= 2, 'crop dimensions: ' + width + 'x' + height);
  const rotated=await call('pixelroom_edit', { input:'art.png', output:'rotated.png', brightness:15, crop:{x:100,y:100,width:400,height:300},rotation:32 });
  const turned=await fs.readFile(rotated.path);assert.equal(turned.readUInt32BE(16),width);assert.equal(turned.readUInt32BE(20),height);assert.notDeepEqual(turned,png);
});
test('PixelRoom rejects a cleanup mask with different dimensions',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});let tiny;try{const page=await browser.newPage();tiny=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1;return c.toDataURL().split(',')[1];});}finally{await browser.close();}await fs.writeFile(path.join(work,'tiny.png'),Buffer.from(tiny,'base64'));
  await assert.rejects(call('pixelroom_inpaint',{input:'sample.jpg',mask:'tiny.png',output:'invalid.png'}),/same dimensions/);
});
test('PixelRoom inpaints an agent mask with the bundled model',{skip:process.env.ROOMSUITE_TEST_CLEANUP_MODEL!=='1'},async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});
  try{const page=await browser.newPage();await page.goto(base+'/pixelroom/');const files=await page.evaluate(()=>{const s=document.createElement('canvas'),m=document.createElement('canvas');s.width=m.width=256;s.height=m.height=128;const c=s.getContext('2d'),mctx=m.getContext('2d');c.fillStyle='#b4a080';c.fillRect(0,0,256,128);c.fillStyle='#222';c.fillRect(100,54,30,20);mctx.fillStyle='#fff';mctx.fillRect(100,54,30,20);return [s.toDataURL().split(',')[1],m.toDataURL().split(',')[1]];});await fs.writeFile(path.join(work,'cleanup-input.png'),Buffer.from(files[0],'base64'));await fs.writeFile(path.join(work,'cleanup-mask.png'),Buffer.from(files[1],'base64'));
    const result=await call('pixelroom_inpaint',{input:'cleanup-input.png',mask:'cleanup-mask.png',output:'cleaned.png'});await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='result';document.body.append(input);});await page.locator('#result').setInputFiles(result.path);const pixel=await page.evaluate(async()=>{const bmp=await createImageBitmap(document.querySelector('#result').files[0]),c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;const x=c.getContext('2d');x.drawImage(bmp,0,0);return [...x.getImageData(110,60,1,1).data];});assert.ok(pixel[0]>80);assert.equal(pixel[3],255);
  }finally{await browser.close();}
});
test('workspace listing and media inspection report useful metadata', async () => {
  const first = await call('roomsuite_list_files',{ limit:1 });
  assert.equal(first.entries.length,1); assert.equal(first.next_offset,1); assert.ok(first.total >= 3);
  const second = await call('roomsuite_list_files',{ offset:first.next_offset,limit:1 });
  assert.notEqual(second.entries[0].name,first.entries[0].name);
  const image = await call('roomsuite_media_info',{ input:'cropped.png' });
  assert.equal(image.kind,'image'); assert.ok(Math.abs(image.width-400) <= 2); assert.ok(Math.abs(image.height-300) <= 2);
  const audio = await call('roomsuite_media_info',{ input:'tone.wav' });
  assert.equal(audio.kind,'audio'); assert.ok(Math.abs(audio.duration_seconds-2) < .01);
  await assert.rejects(call('roomsuite_list_files',{ directory:'..' }),/inside the configured MCP workspace/);
});
test('Cliproom imports reusable media into the library', async () => {
  const result = await call('cliproom_import_media',{ input:'cropped.png' });
  assert.equal(result.asset.kind,'image'); assert.ok(result.asset.id);
  const response = await fetch(base + '/api/assets/' + result.asset.id + '/metadata');
  assert.equal(response.status,200); assert.equal((await response.json()).name,'cropped.png');
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
test('Cliproom rejects duration fields that would otherwise be ignored',async()=>{
  const before=(await fs.readdir(path.join(temp,'data','assets'))).sort();
  for(const [media,pattern] of [[{input:'tone.wav',duration:1},/duration.*still images/i],[{input:'cropped.png',source_out:1},/duration rather than source_out/i]]){
    const result=await client.callTool({name:'cliproom_render',arguments:{output:'invalid-timing',media:[media]}});assert.equal(result.isError,true);assert.equal(result.structuredContent.error.code,'INVALID_ARGUMENT');assert.match(result.content[0].text,pattern);
  }
  assert.deepEqual((await fs.readdir(path.join(temp,'data','assets'))).sort(),before);
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
    output:'video', name:'MCP test', media:[{input:'cropped.png',duration:1.5,scale:.5,x:25,y:45,brightness:80,keyframes:[{time:0,scale:.5,x:25,y:45,opacity:.5},{time:1.4,scale:1,x:75,y:55,opacity:1}]},{input:'edited.wav',start:0}],
    titles:[{text:'Made with RoomSuite',start:0,end:1}], save_project:true
  });
  assert.ok(result.bytes > 1000); assert.ok(result.project.id); assert.equal(result.project.revision,1); savedProjectId = result.project.id;
  assert.match(result.warnings[0],/source-media seconds/);
  const project = await (await fetch(base + '/api/projects/' + result.project.id)).json();
  assert.equal(project.state.name,'MCP test'); assert.equal(project.state.titles[0].text,'Made with RoomSuite'); assert.equal(project.state.assets.length,2);
  assert.equal(project.state.version,4); assert.equal(project.state.clips[0].x,25); assert.equal(project.state.clips[0].scale,.5); assert.equal(project.state.clips[0].keyframes[1].x,75);
});
test('MCP keyframes support explicit timeline time for a trimmed and retimed clip', async () => {
  const result = await call('cliproom_render', { output:'trimmed', save_project:true, render_mode:'offline', media:[{
    input:'cropped.png', source_in:5, duration:7, start:2, speed:2,
    keyframes:[{timeline_time:2,x:25},{timeline_time:2.25,x:50},{source_time:6.5,x:75}]
  }] });
  const project = await (await fetch(base + '/api/projects/' + result.project.id)).json();
  const clip = project.state.clips[0];
  assert.deepEqual(clip.keyframes.map(frame => frame.time),[5,5.5,6.5]);
  assert.deepEqual(result.warnings,[]);
  assert.ok(clip.keyframes.every(frame => !('timeline_time' in frame) && !('source_time' in frame)));
  await assert.rejects(call('cliproom_render',{output:'conflict',media:[{input:'cropped.png',keyframes:[{time:0,timeline_time:0,x:5}]}]}),/exactly one/);
  await assert.rejects(call('cliproom_render',{output:'outside',media:[{input:'cropped.png',start:2,duration:1,keyframes:[{timeline_time:1,x:5}]}]}),/must fall within the clip/);
});
test('create-and-render can render without saving a project', async () => {
  const count = (await call('cliproom_list_projects')).projects.length;
  const result = await call('cliproom_render',{output:'unsaved',render_mode:'offline',media:[{input:'cropped.png',duration:.4,keyframes:[{timeline_time:0,x:25}]}]});
  assert.equal(result.project,null); assert.equal(result.render_mode,'offline'); assert.ok(result.bytes > 1000);
  assert.equal((await call('cliproom_list_projects')).projects.length,count);
});
test('offline rendering produces animated video with audible mixed audio', async () => {
  const project = await (await fetch(base + '/api/projects/' + savedProjectId)).json();
  project.state.audioClips[0].keyframes=[{time:0,volume:0},{time:.9,volume:1}];
  await fs.writeFile(path.join(work,'offline-audio.json'),JSON.stringify(project));
  const result = await call('cliproom_render_project',{project_path:'offline-audio.json',output:'offline',render_mode:'offline'});
  assert.equal(result.render_mode,'offline'); assert.equal(result.mime_type,'video/webm');
  const bytes = await fs.readFile(result.path); assert.equal(bytes.readUInt32BE(0),0x1a45dfa3);
  const browser = await chromium.launch({ headless:true, ...(process.env.ROOMSUITE_BROWSER_PATH ? {executablePath:process.env.ROOMSUITE_BROWSER_PATH} : {}) });
  try {
    const page = await browser.newPage(); await page.goto(base + '/cliproom/');
    await page.evaluate(() => { const input=document.createElement('input'); input.type='file'; input.id='offlineResult'; document.body.append(input); });
    await page.locator('#offlineResult').setInputFiles(result.path);
    const observed = await page.evaluate(async () => {
      const file=document.querySelector('#offlineResult').files[0], audio=new AudioContext();
      const buffer=await audio.decodeAudioData(await file.arrayBuffer()); await audio.close();
      const samples=buffer.getChannelData(0);
      const rms=(start,end)=>{ let sum=0; for(let i=Math.floor(start*buffer.sampleRate);i<Math.min(samples.length,Math.floor(end*buffer.sampleRate));i++) sum+=samples[i]*samples[i]; return Math.sqrt(sum/Math.max(1,Math.floor((end-start)*buffer.sampleRate))); };
      const video=document.createElement('video'); video.muted=true; const url=URL.createObjectURL(file); video.src=url;
      await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');
      const sample=async time=>{await new Promise((resolve,reject)=>{video.onseeked=resolve;video.onerror=reject;video.currentTime=time;});ctx.drawImage(video,0,0);return [ctx.getImageData(Math.round(canvas.width*.25),Math.round(canvas.height*.69),1,1).data[0],ctx.getImageData(Math.round(canvas.width*.75),Math.round(canvas.height*.69),1,1).data[0]];};
      const first=await sample(.2),last=await sample(1.25);URL.revokeObjectURL(url);
      return {first,last,audible:rms(.3,.7),early:rms(.2,.3),late:rms(.7,.8),silent:rms(1.2,1.4),duration:buffer.duration};
    });
    assert.ok(observed.first[0] > observed.first[1] + 15,JSON.stringify(observed));
    assert.ok(observed.last[1] > observed.last[0] + 15,JSON.stringify(observed));
    assert.ok(observed.audible > .03 && observed.silent < .01,JSON.stringify(observed));
    assert.ok(observed.late > observed.early * 2,JSON.stringify(observed));
    assert.ok(Math.abs(observed.duration-1.5) < .1,JSON.stringify(observed));
  } finally { await browser.close(); }
});
test('offline rendering includes normal-speed video frames and original audio', async () => {
  const input = (await fs.readdir(work)).find(name => /^video\.(mp4|webm)$/.test(name));
  assert.ok(input);
  const result = await call('cliproom_render',{output:'offline-video',render_mode:'offline',media:[{input,source_out:1.4}]});
  assert.equal(result.render_mode,'offline');
  const browser = await chromium.launch({ headless:true, ...(process.env.ROOMSUITE_BROWSER_PATH ? {executablePath:process.env.ROOMSUITE_BROWSER_PATH} : {}) });
  try {
    const page = await browser.newPage(); await page.goto(base + '/cliproom/');
    await page.evaluate(() => { const input=document.createElement('input');input.type='file';input.id='videoOffline';document.body.append(input); });
    await page.locator('#videoOffline').setInputFiles(result.path);
    const actual = await page.evaluate(async () => {
      const file=document.querySelector('#videoOffline').files[0],audio=new AudioContext(),buffer=await audio.decodeAudioData(await file.arrayBuffer());await audio.close();
      const data=buffer.getChannelData(0);let power=0;for(let i=Math.floor(.3*buffer.sampleRate);i<Math.floor(.7*buffer.sampleRate);i++)power+=data[i]*data[i];
      const video=document.createElement('video');video.muted=true;const url=URL.createObjectURL(file);video.src=url;await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');
      async function sample(time){await new Promise((resolve,reject)=>{video.onseeked=resolve;video.onerror=reject;video.currentTime=time;});ctx.drawImage(video,0,0);return [ctx.getImageData(Math.round(canvas.width*.25),Math.round(canvas.height*.69),1,1).data[0],ctx.getImageData(Math.round(canvas.width*.75),Math.round(canvas.height*.69),1,1).data[0]];}
      const first=await sample(.2),last=await sample(1.2);URL.revokeObjectURL(url);return {first,last,rms:Math.sqrt(power/(.4*buffer.sampleRate))};
    });
    assert.ok(actual.rms > .02,JSON.stringify(actual));
    assert.ok(actual.first[0] > actual.first[1] + 10 && actual.last[1] > actual.last[0] + 10,JSON.stringify(actual));
  } finally { await browser.close(); }
  const webm = await call('cliproom_render',{output:'offline-webm-input',render_mode:'offline',media:[{input:'offline.webm',source_out:1.4}]});
  assert.equal(webm.mime_type,'video/webm'); assert.ok(webm.bytes > 1000);
});
test('project render endpoint accepts a saved project and returns video without UI driving', async () => {
  const rendered = await call('cliproom_render_project',{ project_id:savedProjectId, output:'rerendered' });
  assert.ok(rendered.bytes > 1000); assert.match(rendered.mime_type,/^video\/(mp4|webm)$/);
  const saved = await (await fetch(base + '/api/projects/' + savedProjectId)).json();
  await fs.writeFile(path.join(work,'render-project.json'),JSON.stringify(saved));
  const fromFile = await call('cliproom_render_project',{ project_path:'render-project.json', output:'from-project-file' });
  assert.ok(fromFile.bytes > 1000);
  const silent = { ...saved.state, audioClips:[], assets:saved.state.assets.filter(asset => asset.kind !== 'audio') };
  const response = await fetch(base + '/api/render', { method:'POST', headers:{ Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json' }, body:JSON.stringify({ project:silent }) });
  assert.equal(response.status,200); assert.match(response.headers.get('content-type'),/^video\/(mp4|webm)$/); assert.ok((await response.arrayBuffer()).byteLength > 1000);
  const browser = await chromium.launch({ headless:true, ...(process.env.ROOMSUITE_BROWSER_PATH ? {executablePath:process.env.ROOMSUITE_BROWSER_PATH} : {}) });
  try {
    const page = await browser.newPage(); await page.goto(base + '/cliproom/');
    await page.evaluate(() => { const input = document.createElement('input'); input.type='file'; input.id='testVideo'; document.body.append(input); });
    await page.locator('#testVideo').setInputFiles(rendered.path);
    const pixels = await page.evaluate(async () => {
      const video = document.createElement('video'); video.muted = true;
      const url = URL.createObjectURL(document.querySelector('#testVideo').files[0]);
      video.src = url;
      await new Promise((resolve,reject) => { video.onloadedmetadata=resolve; video.onerror=reject; });
      const canvas = document.createElement('canvas'); canvas.width=video.videoWidth; canvas.height=video.videoHeight;
      const ctx=canvas.getContext('2d');
      async function sample(time) {
        await new Promise((resolve,reject) => { video.onseeked=resolve; video.onerror=reject; video.currentTime=time; });
        ctx.drawImage(video,0,0);
        return [ctx.getImageData(Math.round(canvas.width*.25),Math.round(canvas.height*.69),1,1).data[0], ctx.getImageData(Math.round(canvas.width*.75),Math.round(canvas.height*.69),1,1).data[0]];
      }
      const first = await sample(.2), last = await sample(1.25); URL.revokeObjectURL(url);
      return {first,last};
    });
    assert.ok(pixels.first[0] > pixels.first[1] + 15, 'picture starts on the left: ' + JSON.stringify(pixels));
    assert.ok(pixels.last[1] > pixels.last[0] + 15, 'picture moves to the right: ' + JSON.stringify(pixels));
  } finally { await browser.close(); }
});
test('project tools retrieve, copy and safely update a saved project', async () => {
  const list = await call('cliproom_list_projects'); assert.ok(list.projects.some(project => project.id === savedProjectId));
  const read = await call('cliproom_get_project',{project_id:savedProjectId}); assert.equal(read.project.state.name,'MCP test');
  const exported = await call('cliproom_get_project',{project_id:savedProjectId,output:'project.json'}); assert.equal(exported.revision,1);
  const project = JSON.parse(await fs.readFile(exported.path,'utf8')); project.state.name='Copied project';
  await fs.writeFile(path.join(work,'copy.json'),JSON.stringify(project));
  const created = await call('cliproom_save_project',{project_path:'copy.json'}); assert.equal(created.revision,1); assert.notEqual(created.project_id,savedProjectId);
  const updated = await call('cliproom_save_project',{project_path:'copy.json',project_id:created.project_id,base_revision:1}); assert.equal(updated.revision,2);
  await assert.rejects(call('cliproom_save_project',{project_path:'copy.json',project_id:created.project_id,base_revision:1}),/changed on another device/);
  await assert.rejects(call('cliproom_get_project',{project_id:savedProjectId,output:'project.json'}),/already exists/);
});
test('keyframes are editable and saved from the Cliproom inspector', async () => {
  const browser = await chromium.launch({ headless:true, ...(process.env.ROOMSUITE_BROWSER_PATH ? {executablePath:process.env.ROOMSUITE_BROWSER_PATH} : {}) });
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:1000} }); await page.goto(base + '/cliproom/');
    await page.locator('#fileInput').setInputFiles(path.join(work,'cropped.png'));
    await page.waitForFunction(() => Number(document.querySelector('#assetCount').textContent) === 1 && !document.querySelector('#importBtn').disabled);
    await page.locator('#addKeyframeBtn').click();
    await page.evaluate(() => seek(1));
    await page.locator('#addKeyframeBtn').click();
    await page.locator('#keyframeX').fill('75'); await page.locator('#keyframeX').dispatchEvent('change');
    await page.locator('#saveBtn').click();
    await page.waitForFunction(() => revision === 1);
    const saved = await page.evaluate(async () => (await (await fetch('/api/projects/' + projectId)).json()).state.clips[0]);
    assert.equal(saved.keyframes.length,2); assert.equal(saved.keyframes[1].time,1); assert.equal(saved.keyframes[1].x,75);
    assert.equal(await page.locator('.keyframe-marker').count(),2);
  } finally { await browser.close(); }
});
test('render endpoint rejects requests without the same-origin header or a valid project', async () => {
  const blocked = await fetch(base + '/api/render', { method:'POST', headers:{ Origin:'https://other.invalid','X-Cliproom-Request':'1','Content-Type':'application/json' }, body:'{}' });
  assert.equal(blocked.status,403);
  const invalid = await fetch(base + '/api/render', { method:'POST', headers:{ Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json' }, body:'{}' });
  assert.equal(invalid.status,400);
  const saved = await (await fetch(base + '/api/projects/' + savedProjectId)).json();
  saved.state.clips[0].keyframes[1].time = saved.state.clips[0].keyframes[0].time;
  const duplicate = await fetch(base + '/api/render', { method:'POST', headers:{ Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json' }, body:JSON.stringify({project:saved.state}) });
  assert.equal(duplicate.status,400); assert.match((await duplicate.json()).error,/unique/);
  saved.state.clips[0].keyframes[1].time=1.4; saved.state.audioClips[0].rate=2;
  const unsupported = await fetch(base + '/api/render', { method:'POST', headers:{ Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json' }, body:JSON.stringify({project:saved.state,render_mode:'offline'}) });
  assert.equal(unsupported.status,422); assert.match((await unsupported.json()).error,/normal speed/);
  await assert.rejects(call('cliproom_render_project',{project_id:savedProjectId,output:'wrong.mp4',render_mode:'offline'}),/outputs WebM/);
  const apng = Buffer.from('89504e470d0a1a0a000000006163544c00000000','hex');
  const upload = await fetch(base + '/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'image/png','X-File-Name':'animated.png'},body:apng});
  assert.equal(upload.status,201); const animated = await upload.json();
  saved.state.audioClips[0].rate=1; saved.state.clips[0].assetId=animated.id;
  saved.state.assets[0]={...animated,kind:'image',duration:5,width:1,height:1};
  const animation = await fetch(base + '/api/render',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({project:saved.state,render_mode:'offline'})});
  assert.equal(animation.status,422); assert.match((await animation.json()).error,/animated images/);
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
test('cancelling an offline render leaves no output file', async () => {
  const project = await (await fetch(base + '/api/projects/' + savedProjectId)).json();
  project.state.clips[0].out = 120;
  await fs.writeFile(path.join(work,'long-project.json'),JSON.stringify(project));
  const controller = new AbortController();
  const pending = client.callTool({name:'cliproom_render_project',arguments:{project_path:'long-project.json',output:'offline-cancelled',render_mode:'offline'}},{signal:controller.signal,timeout:30000});
  setTimeout(() => controller.abort('cancelled by test'),1800);
  await assert.rejects(pending);
  await new Promise(resolve => setTimeout(resolve,500));
  assert.ok(!(await fs.readdir(work)).some(name => name.startsWith('offline-cancelled.')));
  assert.equal((await fetch(base + '/api/health')).status,200);
});
