'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../ProductivitySuite/annotations'),Model=require('../ProductivitySuite/model');
const comment=(start,end,text)=>({id:'c',text:'Review this',quote:text,author:'',resolved:false,anchor:{start,end,text,orphaned:false}});
test('comment anchors follow edits before and within the selected text',()=>{
  let body='Hello brave world',comments=[comment(6,11,'brave')];comments=A.rebase(comments,body,'Dear '+body);body='Dear '+body;assert.deepEqual(comments[0].anchor,{start:11,end:16,text:'brave',orphaned:false});comments=A.rebase(comments,body,body.replace('brave','braXve'));body=body.replace('brave','braXve');assert.equal(comments[0].anchor.text,'braXve');assert.equal(comments[0].anchor.start,11);comments=A.rebase(comments,body,body.replace('braXve',''));assert.equal(comments[0].anchor.orphaned,true);
});
test('partial overlaps retain only surviving text and stale anchors fail safely',()=>{
  const c=[comment(3,8,'defgh')];let updated=A.rebase(c,'abcdefghij','abXYfghij');assert.equal(updated[0].anchor.text,'fgh');assert.equal(updated[0].anchor.start,4);updated=A.rebase(c,'not the original','changed');assert.equal(updated[0].anchor.orphaned,true);assert.equal(A.rebase(c,'abcdefghij','abcdefghij')[0].anchor.orphaned,false);assert.equal(A.orphan(c)[0].anchor.orphaned,true);
  const value=Model.validate({...Model.empty('docsuite',()=> 'id'),comments:c},'docsuite');assert.deepEqual(value.comments[0].anchor,c[0].anchor);assert.throws(()=>Model.validate({...value,comments:[{...c[0],anchor:{...c[0].anchor,end:99}}]},'docsuite'),/anchor/);
});
test('repeated text does not silently move an anchor to a different occurrence',()=>{
  const comments=[comment(0,3,'foo'),{...comment(4,7,'foo'),id:'second'}],ambiguous=A.rebase(comments,'foo foo','foo');assert.ok(ambiguous.every(item=>item.anchor.orphaned));const exact=A.rebase(comments,'foo foo','foo',{start:0,oldEnd:4});assert.equal(exact[0].anchor.orphaned,true);assert.deepEqual(exact[1].anchor,{start:0,end:3,text:'foo',orphaned:false});
});
