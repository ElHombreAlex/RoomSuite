'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('Windows bundle stages application files without local data or dependency directories',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-bundle-test-')),dest=path.join(temp,'app');
  try {
    const run=()=>spawnSync(process.execPath,[path.join(root,'windows','prepare-bundle.cjs'),dest],{encoding:'utf8'});
    const result=run();assert.equal(result.status,0,result.stderr);
    await fs.access(path.join(dest,'server.js'));await fs.access(path.join(dest,'PaintRoom','model.js'));await fs.access(path.join(dest,'PixelRoom','dist','index.html'));await fs.access(path.join(dest,'mcp','server.mjs'));
    await assert.rejects(fs.stat(path.join(dest,'mcp','node_modules')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(dest,'mcp','workspace')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(dest,'cliproom','data')),{code:'ENOENT'});
    assert.notEqual(run().status,0,'existing staging directories must never be overwritten');
  } finally { const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-bundle-test-'));await fs.rm(actual,{recursive:true,force:true}); }
});
