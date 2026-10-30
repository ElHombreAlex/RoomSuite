'use strict';
// MediaRecorder commonly emits a streaming WebM with no Duration element.
// Add it only to a seekless, unknown-length segment so no offsets are invalidated.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RoomWebM=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  function readVint(bytes,position,id=false){
    if(position>=bytes.length)throw new Error('WebM header is incomplete.');
    const first=bytes[position];let width=1,marker=0x80;while(width<=8&&!(first&marker)){width++;marker>>=1;}
    if(width>8||position+width>bytes.length||(id&&width>4))throw new Error('Invalid WebM header.');
    let value=BigInt(id?first:first&(marker-1));for(let i=1;i<width;i++)value=(value<<8n)|BigInt(bytes[position+i]);
    const unknown=!id&&value===(1n<<BigInt(width*7))-1n;
    if(!unknown&&value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('WebM element is too large.');
    return {width,value:unknown?null:Number(value),unknown};
  }
  function element(bytes,position){const id=readVint(bytes,position,true),size=readVint(bytes,position+id.width),data=position+id.width+size.width;return {id:id.value,size:size.value,unknown:size.unknown,sizePos:position+id.width,sizeWidth:size.width,data,end:size.unknown?null:data+size.value};}
  function encodedSize(size,width){let n=BigInt(size);if(n>=(1n<<BigInt(width*7))-1n)throw new Error('WebM metadata is too large to update safely.');const out=new Uint8Array(width);for(let i=width-1;i>=0;i--){out[i]=Number(n&255n);n>>=8n;}out[0]|=1<<(8-width);return out;}
  async function withDuration(blob,seconds){
    if(!/^video\/webm|^audio\/webm/i.test(blob.type)||!Number.isFinite(seconds)||seconds<=0)return blob;
    const bytes=new Uint8Array(await blob.slice(0,Math.min(blob.size,2*1024*1024)).arrayBuffer());let pos=0,segment;
    while(pos<bytes.length){const item=element(bytes,pos);if(item.id===0x18538067){segment=item;break;}if(item.end===null||item.end>bytes.length)throw new Error('WebM segment was not found.');pos=item.end;}
    if(!segment)throw new Error('WebM segment was not found.');
    let info,seekHead=false;pos=segment.data;
    while(pos<bytes.length){const item=element(bytes,pos);if(item.id===0x114d9b74)seekHead=true;if(item.id===0x1549a966)info=item;if(item.id===0x1f43b675)break;if(item.end===null||item.end>bytes.length)break;pos=item.end;}
    if(!info||info.end===null||info.end>bytes.length)throw new Error('WebM information is incomplete.');
    let scale=1000000,duration=null;pos=info.data;
    while(pos<info.end){const item=element(bytes,pos);if(item.end===null||item.end>info.end)throw new Error('Invalid WebM information.');
      if(item.id===0x2ad7b1){scale=0;for(let i=item.data;i<item.end;i++)scale=scale*256+bytes[i];}
      if(item.id===0x4489)duration=item;pos=item.end;
    }
    if(!Number.isFinite(scale)||scale<=0)throw new Error('Invalid WebM timestamp scale.');
    const units=seconds*1000000000/scale;
    if(duration){if(duration.size!==4&&duration.size!==8)throw new Error('Unsupported WebM duration element.');const prefix=bytes.slice(0,duration.end),view=new DataView(prefix.buffer);if(duration.size===4)view.setFloat32(duration.data,units);else view.setFloat64(duration.data,units);return new Blob([prefix,blob.slice(duration.end)],{type:blob.type});}
    if(!segment.unknown||seekHead)throw new Error('This WebM uses seek offsets and cannot be updated safely.');
    const prefix=bytes.slice(0,info.end);prefix.set(encodedSize(info.size+11,info.sizeWidth),info.sizePos);
    const added=new Uint8Array(11);added.set([0x44,0x89,0x88]);new DataView(added.buffer).setFloat64(3,units);
    return new Blob([prefix,added,blob.slice(info.end)],{type:blob.type});
  }
  return {withDuration};
});
