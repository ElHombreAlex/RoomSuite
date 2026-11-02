'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Links=require('../NotesRoom/links.js');
const first='550e8400-e29b-41d4-a716-446655440000',second='550e8400-e29b-41d4-a716-446655440001';
test('stable note links use IDs and ignore images, code and external URLs',()=>{
  const marker=Links.marker(first,'A [bracket] & title');assert.equal(marker,'[A  bracket  & title](/notesroom/?note='+first+')');const body=[marker,'`'+Links.marker(second,'Inline')+'`','```',Links.marker(second,'Code'),'```','!'+Links.marker(second,'Image'),'[External](https://elsewhere.invalid/notesroom/?note='+second+')'].join('\n');assert.deepEqual(Links.find(body),{ids:[first],truncated:false});assert.throws(()=>Links.marker('../escape','bad'),/Invalid/);
});
test('link discovery is bounded and deduplicates repeated targets',()=>{const id=n=>'550e8400-e29b-41d4-a716-'+n.toString(16).padStart(12,'0'),body=Array.from({length:501},(_,i)=>Links.marker(id(i),'N')).join('\n');const result=Links.find(body+'\n'+Links.marker(id(0),'Again'));assert.equal(result.ids.length,500);assert.equal(result.truncated,true);});
