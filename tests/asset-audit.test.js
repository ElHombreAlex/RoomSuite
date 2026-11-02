'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{audit}=require('../cliproom/asset-audit.js');
test('media audit checks saved references and fails closed when a project is unreadable',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-audit-')),assetsDir=path.join(temp,'assets'),projectsDir=path.join(temp,'projects');
  try{await fs.mkdir(assetsDir);await fs.mkdir(projectsDir);const first=crypto.randomUUID(),second=crypto.randomUUID(),project=crypto.randomUUID(),options={assetsDir,projectsDir,mediaTypes:new Set(['image/png'])};
    for(const [id,name] of [[first,'Referenced'],[second,'Unused']]){await fs.writeFile(path.join(assetsDir,id),Buffer.from('image'));await fs.writeFile(path.join(assetsDir,id+'.json'),JSON.stringify({id,name,type:'image/png',size:5}));}
    await fs.writeFile(path.join(projectsDir,project+'.json'),JSON.stringify({id:project,revision:1,state:{name:'Story',assets:[],clips:[{assetId:first.toUpperCase()}]}}));
    let report=await audit(options);assert.equal(report.complete,true);assert.equal(report.unreferenced_count,1);assert.equal(report.items.find(item=>item.id===first).status,'referenced');assert.equal(report.items.find(item=>item.id===second).status,'unreferenced');assert.equal((await audit({...options,filter:'unused'})).items[0].id,second);
    await fs.writeFile(path.join(projectsDir,crypto.randomUUID()+'.json'),'{broken');report=await audit(options);assert.equal(report.complete,false);assert.equal(report.unreferenced_count,null);assert.equal(report.items.find(item=>item.id===second).status,'unknown');assert.equal((await audit({...options,filter:'unused'})).total,0);assert.ok(report.issues.length);
  }finally{const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-audit-'));await fs.rm(actual,{recursive:true,force:true});}
});
