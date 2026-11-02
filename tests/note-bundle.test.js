'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const bundle=require('../workspace/note-bundle');
const fail=(status,message)=>Object.assign(new Error(message),{status}),relative=value=>{if(value.includes('..'))throw fail(400,'Invalid path');return value;},noteValues=value=>value;
function sample(){const data=Buffer.from('image bytes');return {format:'roomsuite.note-bundle',version:1,note:{title:'Note',body:'![Image](/api/workspace/file?path=photo.png){width=420}',folder:'',tags:[]},assets:[{path:'photo.png',attachment:null,mime_type:'image/png',bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),data:data.toString('base64')}]};}
test('note bundles validate every referenced asset and reject unexpected, unsafe or altered data',()=>{
  const options={relative,noteValues,fail},valid=sample();assert.equal(bundle.validate(valid,options).assets.size,1);
  for(const mutate of [x=>x.assets=[],x=>x.assets.push({...x.assets[0]}),x=>x.assets[0].sha256='0'.repeat(64),x=>x.assets[0].mime_type='audio/webm',x=>x.assets[0].data+='=',x=>x.note.body='![External](https://example.com/photo.png)',x=>{x.note.body='![Image](/api/workspace/file?path=..%2Fphoto.png)';x.assets[0].path='../photo.png';},x=>x.version=2]){const damaged=structuredClone(valid);mutate(damaged);assert.throws(()=>bundle.validate(damaged,options));}
  const code=sample();code.note.body+='\n```\n![External](https://example.com/photo.png)\n```';assert.equal(bundle.validate(code,options).assets.size,1);
});
