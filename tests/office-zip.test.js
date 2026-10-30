'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const JSZip=require('../ProductivitySuite/vendor/jszip');
const fflate=require('../ProductivitySuite/vendor/fflate');
const guard=require('../ProductivitySuite/zipguard');
async function zip(entries){const result=new JSZip();for(const [name,value] of Object.entries(entries))result.file(name,value);return result.generateAsync({type:'uint8array',compression:'DEFLATE'});}
test('Office archive inspection validates the actual decompressed size',async()=>{
  const bytes=await zip({'word/document.xml':'A'.repeat(300000),'[Content_Types].xml':'types'}),manifest=guard.inspect(bytes);assert.equal(guard.verify(bytes,manifest,fflate),true);
  const changed=bytes.slice(),view=new DataView(changed.buffer,changed.byteOffset,changed.byteLength);for(let i=0;i<changed.length-46;i++)if(view.getUint32(i,true)===0x02014b50){const nameLength=view.getUint16(i+28,true),name=new TextDecoder().decode(changed.subarray(i+46,i+46+nameLength));if(name==='word/document.xml'){view.setUint32(i+24,16,true);break;}}
  assert.throws(()=>guard.verify(changed,guard.inspect(changed),fflate),/decompression limits|size does not match/);
});
test('Office archive inspection rejects traversal and encrypted entries',async()=>{
  const traversal=await zip({'../escape.xml':'no'});assert.throws(()=>guard.inspect(traversal),/Unsafe/);
  const bytes=await zip({'safe.xml':'hello'}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=0;i<bytes.length-46;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint16(i+8,view.getUint16(i+8,true)|1,true);break;}assert.throws(()=>guard.inspect(bytes),/encrypted/);
});
