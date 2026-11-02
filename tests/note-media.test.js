'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const media=require('../NotesRoom/media.js');
const id='12345678-1234-4123-8123-123456789abc';
test('note media references preserve paths, types and widths while upgrading legacy links',()=>{
  const legacy='![The image](/api/workspace/file?path=Photos%2Fmy+image.png){width=610}';
  const parsed=media.parseLine(legacy);assert.equal(parsed.path,'Photos/my image.png');assert.equal(parsed.attachment,null);assert.equal(parsed.width,610);
  const updated=media.rewrite(legacy,id),next=media.parseLine(updated);assert.equal(next.attachment,id);assert.equal(next.path,parsed.path);assert.equal(next.width,610);assert.equal(next.alt,'The image');assert.match(media.url(next.path,id,true),/^\/api\/workspace\/media\?/);
  assert.equal(media.parseLine(media.marker('audio','voice/clip.webm',id)).type,'audio');assert.equal(media.parseLine('![x](/api/workspace/file?path=x.png&attachment=bad)'),null);assert.equal(media.parseLine('![x](/api/workspace/file?path=x.png&path=y.png)'),null);assert.equal(media.parseLine('![x](https://example.com/x.png)'),null);
  const result=media.references(legacy+'\n```\n'+legacy+'\n```\n'+media.marker('audio','v.webm',id));assert.deepEqual(result.items.map(item=>item.index),[0,4]);
});
