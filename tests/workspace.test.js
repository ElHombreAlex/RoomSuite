'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const port = 24000 + Math.floor(Math.random()*20000), base = 'http://127.0.0.1:' + port;
let dir, server;
const headers = { Origin:base, 'X-Cliproom-Request':'1' };
async function request(route, method='GET', data, extra={}) {
  return fetch(base+route,{method,headers:{...headers,...(data !== undefined ? {'Content-Type':'application/json'} : {}),...extra},...(data !== undefined ? {body:JSON.stringify(data)} : {})});
}
async function upload(file, data, extra={}) { return fetch(base+'/api/workspace/upload?'+new URLSearchParams({path:file}),{method:'POST',headers:{...headers,...extra},body:data}); }
before(async () => {
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-workspace-test-'));
  server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:dir,ROOMSUITE_MAX_FILE_BYTES:'4096',ROOMSUITE_MAX_STORAGE_BYTES:'8192'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start.')),10000);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited: '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});
});
after(async () => {
  if(server && server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
  const rel=path.relative(os.tmpdir(),dir || '');if(dir&&rel.startsWith('roomsuite-workspace-test-')&&!rel.includes(path.sep))await fs.rm(dir,{recursive:true,force:true});
});

test('shared files support folders, transfers and safe moves with limits', async () => {
  assert.equal((await request('/api/workspace/folder','POST',{path:'Photos'})).status,201);
  assert.equal((await upload('Photos/café.txt','hello')).status,201);
  assert.equal((await upload('Photos/café.txt','replace')).status,409);
  assert.equal((await upload('../escape','no')).status,400);
  assert.equal((await upload('Photos/large.bin',Buffer.alloc(4097))).status,413);
  assert.equal((await upload('Photos/denied.txt','no',{Origin:'https://other.invalid'})).status,403);
  const list=await (await request('/api/workspace/list?path=Photos')).json(); assert.equal(list.entries[0].name,'café.txt');
  const search=await (await request('/api/workspace/search?'+new URLSearchParams({q:'CAFÉ'}))).json(); assert.equal(search.entries[0].path,'Photos/café.txt'); assert.equal(search.truncated,false);
  const downloaded=await request('/api/workspace/file?'+new URLSearchParams({path:'Photos/café.txt'}));
  assert.equal(await downloaded.text(),'hello'); assert.match(downloaded.headers.get('content-disposition'),/^attachment/);
  assert.equal((await request('/api/workspace/move','POST',{from:'Photos/café.txt',to:'renamed.txt'})).status,200);
  assert.equal((await request('/api/workspace/delete','POST',{path:'Photos'})).status,400);
  assert.equal((await request('/api/workspace/delete','POST',{path:'Photos',recursive:true})).status,200);
  assert.equal((await request('/api/workspace/delete','POST',{path:''})).status,400);
  assert.equal((await upload('one.bin',Buffer.alloc(4096))).status,201);
  assert.equal((await upload('two.bin',Buffer.alloc(4096))).status,413);
  assert.equal((await request('/api/workspace/delete','POST',{path:'one.bin'})).status,200);
  assert.equal((await request('/api/workspace/delete','POST',{path:'renamed.txt'})).status,200);
});
test('notes preserve revisions, Markdown, tags and folders', async () => {
  assert.equal((await request('/api/notes/folders','POST',{path:'Work/Projects'})).status,201);
  const created=await (await request('/api/notes','POST',{title:'A note',body:'# Hello\n**World**',folder:'Work/Projects',tags:['launch','ideas']})).json();
  assert.equal(created.revision,1); assert.equal(created.body,'# Hello\n**World**');
  const found=await (await request('/api/notes?'+new URLSearchParams({search:'world',tag:'launch'}))).json(); assert.equal(found.notes[0].id,created.id);
  const note='/api/notes/'+created.id;
  assert.equal((await request(note,'PUT',{baseRevision:1,title:'Changed',body:'New text',folder:'Work',tags:[]})).status,200);
  assert.equal((await request(note,'PUT',{baseRevision:1,title:'Stale',body:'No',folder:'',tags:[]})).status,409);
  assert.equal((await request('/api/notes/folders','DELETE',{path:'Work'})).status,409);
  assert.equal((await request(note,'DELETE',{baseRevision:1})).status,409);
  assert.equal((await request(note,'DELETE',{baseRevision:2})).status,200);
  assert.equal((await request('/api/notes/folders','DELETE',{path:'Work/Projects'})).status,200);
  assert.equal((await request('/api/notes/folders','DELETE',{path:'Work'})).status,200);
});
test('productivity saves obey the shared file limit',async()=>{
  const Model=require('../ProductivitySuite/model'),route='/api/workspace/productivity?path=limit.docsuite',state=Model.empty('docsuite',()=> 'id');
  assert.equal((await request(route,'PUT',{baseRevision:null,state:{...state,html:'x'.repeat(5000)}})).status,413);
  assert.equal((await request(route,'PUT',{baseRevision:null,state})).status,200);
  assert.equal((await request('/api/workspace/delete','POST',{path:'limit.docsuite'})).status,200);
});
test('PaintRoom projects can be saved and reopened without overwriting newer edits', async () => {
  const id=crypto.randomUUID(), state=require('../PaintRoom/model').empty(()=>crypto.randomUUID(),'Canvas',640,480);
  const route='/api/paint/projects/'+id;
  assert.equal((await request(route,'PUT',{baseRevision:0,state})).status,200);
  const loaded=await (await request(route)).json(); assert.equal(loaded.state.name,'Canvas'); assert.equal(loaded.revision,1);
  assert.equal((await request(route,'PUT',{baseRevision:0,state})).status,409);
  assert.equal((await request(route,'DELETE',{baseRevision:1})).status,200);
  assert.equal((await request(route)).status,404);
});

test('note media streams only supported shared file types with sandboxed responses',async()=>{
  const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');assert.equal((await upload('note-image.png',png)).status,201);
  const media=await request('/api/workspace/media?path=note-image.png');assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/png');assert.match(media.headers.get('content-security-policy'),/sandbox/);assert.equal(media.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await media.arrayBuffer()),png);
  const range=await request('/api/workspace/media?path=note-image.png','GET',undefined,{Range:'bytes=0-3'});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),png.subarray(0,4));
  assert.equal((await upload('not-safe.svg','<svg></svg>')).status,201);assert.equal((await request('/api/workspace/media?path=not-safe.svg')).status,415);assert.equal((await request('/api/workspace/media?'+new URLSearchParams({path:'../escape.png'}))).status,400);
  assert.equal((await request('/api/workspace/delete','POST',{path:'note-image.png'})).status,200);assert.equal((await request('/api/workspace/delete','POST',{path:'not-safe.svg'})).status,200);
});
