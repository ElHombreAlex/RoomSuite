'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const DeckTemplate=require('../ProductivitySuite/deck-template');

test('slide templates round-trip content and instantiate independent IDs',()=>{
  const slide={id:'slide',title:'Reusable',body:'Hello',background:'#ffffff',image:'',notes:'Presenter notes',elements:[{id:'caption',type:'text',text:'Caption',box:{x:.1,y:.2,w:.3,h:.2},style:{size:24}}]};
  const template=DeckTemplate.parse(DeckTemplate.serialize(DeckTemplate.create(slide,'My slide')));let next=0;
  const copy=DeckTemplate.instantiate(template,()=>`copy-${++next}`);
  assert.equal(copy.title,'Reusable');assert.equal(copy.notes,'Presenter notes');assert.equal(copy.elements[0].text,'Caption');assert.equal(copy.id,'copy-1');assert.equal(copy.elements[0].id,'copy-2');assert.equal(template.slide.elements[0].id,'caption');
});
test('slide templates reject malformed, unsupported, oversized and invalid content',()=>{
  const good=DeckTemplate.create({id:'s',title:'A',body:'',background:'#ffffff',image:''},'Slide');
  assert.throws(()=>DeckTemplate.parse('{'),/valid JSON/);assert.throws(()=>DeckTemplate.validate({...good,version:2}),/Unsupported/);assert.throws(()=>DeckTemplate.validate({...good,extra:true}),/Invalid/);assert.throws(()=>DeckTemplate.validate({...good,slide:{...good.slide,background:'red'}}),/background/);assert.throws(()=>DeckTemplate.parse(' '.repeat(DeckTemplate.maxBytes+1)),/7 MiB/);
});
test('presentation size is checked before an oversized save or insertion',()=>{
  const data='data:image/png;base64,'+'A'.repeat(2_800_000),slide={id:'s',title:'A',body:'',background:'#ffffff',image:'',elements:Array.from({length:4},(_,i)=>({id:'image-'+i,type:'image',box:{x:0,y:0,w:.2,h:.2},data}))},deck={format:'roomsuite-presentation',version:1,title:'Deck',slides:[slide]};
  assert.throws(()=>DeckTemplate.assertFits(deck),/8 MiB save limit/);
});
