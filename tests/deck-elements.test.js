'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Deck=require('../ProductivitySuite/deck-elements'),Model=require('../ProductivitySuite/model');
const item=(id,x,y,w,h)=>({id,type:'text',box:{x,y,w,h},text:id,style:Model.deckTextStyles.body});
test('independent slide elements validate and retain positions and speaker notes',()=>{
  const state=Model.empty('decksuite',()=> 'slide'),slide=state.slides[0];slide.notes='Speaker\nnotes';slide.elements=[item('a',.1,.2,.2,.1),item('b',.5,.4,.2,.2)];const saved=Model.validate(state,'decksuite');assert.equal(saved.slides[0].notes,'Speaker\nnotes');assert.equal(saved.slides[0].elements[1].box.x,.5);assert.throws(()=>Model.validate({...state,slides:[{...slide,elements:[item('a',.9,.2,.2,.1)]}]},'decksuite'),/position/);assert.throws(()=>Model.validate({...state,slides:[{...slide,elements:[slide.elements[0],slide.elements[0]]}]},'decksuite'),/unique/);
});
test('slide elements align, distribute and move within the slide',()=>{
  const original=[item('a',.1,.1,.1,.1),item('b',.3,.3,.2,.1),item('c',.8,.5,.1,.1)],aligned=Deck.apply(original,['a','b'],'top');assert.equal(aligned[1].box.y,.1);const spaced=Deck.apply(original,['a','b','c'],'horizontal');const gap1=spaced[1].box.x-(spaced[0].box.x+spaced[0].box.w),gap2=spaced[2].box.x-(spaced[1].box.x+spaced[1].box.w);assert.ok(Math.abs(gap1-gap2)<1e-9);const moved=Deck.move(original,['a','b'],1,-1);assert.ok(Math.abs(moved.dx-.5)<1e-9);assert.equal(moved.dy,-.1);assert.equal(original[0].box.x,.1);assert.throws(()=>Deck.apply(original,['a','missing'],'left'),/not found/);
});
