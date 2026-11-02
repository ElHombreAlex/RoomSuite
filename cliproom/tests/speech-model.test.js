'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {createSpeechModel}=require('../speech-model');
async function temporary(fn){const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'roomsuite-speech-model-'));try{await fn(dir);}finally{const actual=await fsp.realpath(dir),parent=await fsp.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-speech-model-'));await fsp.rm(actual,{recursive:true,force:true});}}
const data=Buffer.from('verified model bytes'),hash=crypto.createHash('sha256').update(data).digest('hex'),manifest=[{name:'models/example/model.bin',url:'https://example.invalid/fixed',size:data.length,algorithm:'sha256',digest:hash}];

test('speech model installation is verified, retry-safe and refuses damaged files',()=>temporary(async dir=>{
  let calls=0;const model=createSpeechModel({directory:path.join(dir,'cache'),manifest,fetchImpl:async()=>{calls++;return new Response(data);}});assert.equal((await model.state()).installed,false);
  const first=await model.install();assert.equal(first.installed,true);assert.equal(first.already_installed,false);assert.equal((await model.install()).already_installed,true);assert.equal(calls,1);
  assert.deepEqual(await fsp.readFile(await model.file('models/example/model.bin')),data);await assert.rejects(model.file('../other'),/not found/);
  const file=await model.file('models/example/model.bin');await fsp.writeFile(file,Buffer.alloc(data.length,1));const future=new Date(Date.now()+5000);await fsp.utimes(file,future,future);assert.equal((await model.state()).invalid,true);await assert.rejects(model.install(),/damaged/);
}));
test('bad or simultaneous downloads never become installed',()=>temporary(async dir=>{
  let unblock;const gate=new Promise(resolve=>{unblock=resolve;}),model=createSpeechModel({directory:path.join(dir,'cache'),manifest,fetchImpl:async()=>{await gate;return new Response(Buffer.from('wrong'));}}),first=model.install();
  await assert.rejects(model.install(),/already downloading/);unblock();await assert.rejects(first,/integrity check/);assert.equal((await model.state()).installed,false);assert.deepEqual(await fsp.readdir(path.join(dir,'cache')),[]);
}));
