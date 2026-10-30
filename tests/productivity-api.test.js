'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const http=require('node:http');
const Model=require('../ProductivitySuite/model');
const port=24000+Math.floor(Math.random()*20000),base='http://127.0.0.1:'+port;
let dir,server;
const headers={Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'};
const route=file=>'/api/workspace/productivity?'+new URLSearchParams({path:file});
async function put(file,baseRevision,state,extra={}){return fetch(base+route(file),{method:'PUT',headers:{...headers,...extra},body:JSON.stringify({baseRevision,state})});}
before(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-productivity-test-'));server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:dir},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start.')),10000);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited: '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});});
after(async()=>{if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}const actual=await fs.realpath(dir),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-productivity-test-'));await fs.rm(actual,{recursive:true,force:true});});
test('productivity files appear in shared storage and reject stale or unsafe updates',async()=>{
  for(const [kind,ext] of [['docsuite','docsuite'],['gridsuite','gridsuite'],['decksuite','decksuite'],['plansuite','plansuite']]){
    const file='test.'+ext,state=Model.empty(kind,()=> 'id');const created=await put(file,null,state);assert.equal(created.status,200,kind);const saved=await created.json();assert.match(saved.revision,/^[a-f0-9]{64}$/);
    assert.equal((await put(file,null,state)).status,409);const changed={...state,title:'Changed'};const updated=await put(file,saved.revision,changed);assert.equal(updated.status,200,await updated.text());assert.equal((await put(file,saved.revision,state)).status,409);
    const fetched=await (await fetch(base+route(file))).json();assert.equal(fetched.state.title,'Changed');
  }
  const list=await (await fetch(base+'/api/workspace/list?path=')).json();assert.equal(list.entries.length,4);
  assert.equal((await put('../escape.docsuite',null,Model.empty('docsuite',()=> 'id'))).status,400);
  assert.equal((await put('denied.docsuite',null,Model.empty('docsuite',()=> 'id'),{Origin:'https://other.invalid'})).status,403);
  assert.equal((await put('wrong.docsuite',null,Model.empty('gridsuite',()=> 'id'))).status,400);
  for(const route of ['/docsuite/','/gridsuite/','/decksuite/','/plansuite/'])assert.equal((await fetch(base+route)).status,200);
});
test('ntfy configuration keeps tokens private and sends a test to the configured endpoint',async()=>{
  const messages=[];const receiver=http.createServer((req,res)=>{const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{messages.push({url:req.url,authorization:req.headers.authorization,body:Buffer.concat(chunks).toString()});res.writeHead(200);res.end('ok');});});
  await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));
  try{
    const input={enabled:true,server:'http://127.0.0.1:'+receiver.address().port,topic:'private-topic',token:'test-token'};
    const configured=await fetch(base+'/api/workspace/notifications',{method:'PUT',headers,body:JSON.stringify(input)});assert.equal(configured.status,200);const settings=await configured.json();assert.equal(settings.hasToken,true);assert.equal(settings.token,undefined);
    const sent=await fetch(base+'/api/workspace/notifications/test',{method:'POST',headers});assert.equal(sent.status,200);assert.equal(messages.length,1);assert.equal(messages[0].url,'/private-topic');assert.equal(messages[0].authorization,'Bearer test-token');assert.match(messages[0].body,/working/);
    const loaded=await (await fetch(base+'/api/workspace/notifications')).json();assert.equal(loaded.hasToken,true);assert.equal(loaded.token,undefined);
    assert.equal((await fetch(base+'/api/workspace/notifications',{method:'PUT',headers:{...headers,Origin:'https://other.invalid'},body:JSON.stringify(input)})).status,403);
  }finally{await new Promise(resolve=>receiver.close(resolve));}
});
