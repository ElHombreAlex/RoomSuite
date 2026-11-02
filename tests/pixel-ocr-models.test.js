'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
test('bundled French, Spanish and Italian OCR models match the pinned upstream blobs',()=>{
  const expected={fra:'d9e2b2160be0d1ca3b8f1bf2730fae476ef3b4a6',spa:'72e901f13ca52cfe34cf239a368b9ed3c0ddaf26',ita:'edbffbe0e51892b240630b5eeabededa7e7c9c4f'};
  for(const [language,sha] of Object.entries(expected)){const data=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../PixelRoom/dist/vendor/ocr',language+'.traineddata.gz'))),actual=crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');assert.equal(actual,sha,language);}
});
