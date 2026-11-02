'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Speech=require('../public/speech');
test('recognized segments follow clip trim, placement and speed',()=>{
  const clip={start:10,in:2,out:12,rate:2},result=Speech.cues({chunks:[{text:' Hello world ',timestamp:[1,5]},{text:' Next line ',timestamp:[5,9]}]},clip);
  assert.deepEqual(result.cues,[{start:10.5,end:12.5,text:'Hello world'},{start:12.5,end:14.5,text:'Next line'}]);assert.match(result.warnings[0],/approximate/);
});
test('speech cues bound long text and report estimated times',()=>{
  const text=('word '.repeat(90)).trim(),result=Speech.cues({text},{start:0,in:0,out:5,rate:1});assert.ok(result.cues.length>1);assert.ok(result.cues.every(cue=>cue.text.length<=230&&cue.end>cue.start));assert.ok(result.warnings.some(message=>message.includes('estimated')));assert.throws(()=>Speech.cues({chunks:[]},{start:0,in:0,out:5,rate:1}),/No intelligible speech/);
});
