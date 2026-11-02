'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Sub=require('../public/subtitles');
test('SRT and WebVTT cues preserve timing and text, with explicit formatting warnings',()=>{
  const srt='1\n00:00:00,125 --> 00:00:01,250\nHello &amp; <b>world</b>\n\n2\n00:00:01,500 --> 00:00:02,000\nSecond line\n';const parsed=Sub.parse(srt);assert.equal(parsed.format,'srt');assert.deepEqual(parsed.cues,[{start:.125,end:1.25,text:'Hello & world'},{start:1.5,end:2,text:'Second line'}]);assert.ok(parsed.warnings.some(w=>/formatting/.test(w)));const built=Sub.titles(parsed.cues,{duration:2},()=> 'id');const vtt=Sub.serialize(built.titles,'vtt');assert.match(vtt.text,/WEBVTT/);assert.match(vtt.text,/Hello &amp; world/);assert.deepEqual(Sub.parse(vtt.text).cues,parsed.cues);const back=Sub.serialize(built.titles,'srt');assert.match(back.text,/00:00:00,125 --> 00:00:01,250/);
  const complex=Sub.parse('WEBVTT\n\nNOTE comment\nignored\n\nSTYLE\n::cue { color: red }\n\ncue-id\n00:01.000 --> 00:03.000 align:start\n<v Ada>Hello</v>\n');assert.equal(complex.cues[0].text,'Hello');assert.ok(complex.warnings.some(w=>/styles/.test(w)));assert.ok(complex.warnings.some(w=>/positioning/.test(w)));
});
test('generation makes reviewable estimates and timeline clipping is explicit',()=>{
  const result=Sub.generate('First\nSecond',1,5);assert.deepEqual(result.cues,[{text:'First',start:1,end:3},{text:'Second',start:3,end:5}]);assert.match(result.warnings[0],/not speech recognition/);assert.throws(()=>Sub.titles(result.cues,{duration:4},()=> 'id'),/outside/);const clipped=Sub.titles(result.cues,{duration:4,clip:true},()=> 'id');assert.equal(clipped.titles[1].end,4);assert.match(clipped.warnings[0],/Clipped 1/);assert.throws(()=>Sub.titles(result.cues,{duration:1,offset:10,clip:true},()=> 'id'),/No subtitles/);
});
test('invalid, oversized and non-UTF-friendly subtitle content is rejected',()=>{
  for(const text of ['x','1\n00:00:99,000 --> 00:01:00,000\nBad','1\n00:00:02,000 --> 00:00:01,000\nBackwards','1\n00:00:00,000 --> 00:00:01,000\n'+('x'.repeat(241)),'1\n00:00:00,000 --> 00:00:01,000\nBad\u0000text'])assert.throws(()=>Sub.parse(text));assert.throws(()=>Sub.generate('x\n'.repeat(501),0,100),/1–500/);assert.throws(()=>Sub.parse('x'.repeat(Sub.maxBytes+1)),/512 KiB/);assert.throws(()=>Sub.serialize([], 'vtt'),/1–500/);
});
