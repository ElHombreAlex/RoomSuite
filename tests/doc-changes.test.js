'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Changes=require('../ProductivitySuite/changes'),Model=require('../ProductivitySuite/model');let nextId=0;const id=()=>String(++nextId);
test('tracked insertions merge and remain reviewable after unrelated edits',()=>{
  let result=Changes.record([],'Hi ','Hi a',{start:3,oldEnd:3},true,id);result=Changes.record(result.changes,'Hi a','Hi ab',{start:4,oldEnd:4},true,id);assert.equal(result.changes.length,1);assert.equal(result.changes[0].inserted,'ab');assert.equal(Changes.canReject(result.changes[0],'Hi ab'),true);result=Changes.record(result.changes,'Hi ab','Dear Hi ab',{start:0,oldEnd:0},false,id);assert.equal(result.changes[0].start,8);assert.equal(Changes.canReject(result.changes[0],'Dear Hi ab'),true);
});
test('overlapping, ambiguous or externally changed edits cannot be rejected silently',()=>{
  let change=Changes.record([],'Hello world','Hello brave world',{start:6,oldEnd:6},true,id).changes[0];assert.equal(Changes.canReject(change,'Hello brave world'),true);assert.equal(Changes.canReject(change,'HELLO brave world'),false);const overlap=Changes.rebase([change],'Hello brave world','Hello brXave world',{start:8,oldEnd:8});assert.equal(overlap[0].conflicted,true);const ambiguous=Changes.record([],'foo foo','foo',null,true,id);assert.equal(ambiguous.changes[0].conflicted,true);assert.match(ambiguous.warning,/manual/);const stopped=Changes.record([],'x','x'+'a'.repeat(10001),{start:1,oldEnd:1},true,id);assert.equal(stopped.stopped,true);
  const doc=Model.validate({...Model.empty('docsuite',id),changes:[change]},'docsuite');assert.equal(doc.changes[0].inserted,'brave ');assert.throws(()=>Model.validate({...doc,changes:[{...change,left:'x'.repeat(33)}]},'docsuite'),/tracked/);
});
