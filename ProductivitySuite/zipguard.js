'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OfficeZipGuard=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const MAX_INPUT=20*1024*1024,MAX_ENTRY=20*1024*1024,MAX_TOTAL=64*1024*1024,MAX_ENTRIES=3000;
  function inspect(buffer){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);if(bytes.byteLength>MAX_INPUT||bytes.byteLength<22)throw new Error('Office files must be valid ZIP files of at most 20 MB.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=offset=>view.getUint16(offset,true),u32=offset=>view.getUint32(offset,true);let end=-1;
    for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(u32(offset)===0x06054b50&&offset+22+u16(offset+20)===bytes.length){end=offset;break;}
    if(end<0)throw new Error('This Office file is not a valid ZIP archive.');
    const disk=u16(end+4),directoryDisk=u16(end+6),count=u16(end+10),size=u32(end+12),start=u32(end+16);
    if(disk||directoryDisk||u16(end+8)!==count||count===0xffff||size===0xffffffff||start===0xffffffff||count>MAX_ENTRIES||start+size>end)throw new Error('This Office archive uses an unsupported ZIP structure.');
    const names=new Set(),entries=[],decoder=new TextDecoder('utf-8',{fatal:true});let offset=start,total=0;
    for(let i=0;i<count;i++){
      if(offset+46>start+size||u32(offset)!==0x02014b50)throw new Error('Invalid Office archive directory.');
      const flags=u16(offset+8),method=u16(offset+10),compressed=u32(offset+20),expanded=u32(offset+24),nameLength=u16(offset+28),extraLength=u16(offset+30),commentLength=u16(offset+32),local=u32(offset+42),next=offset+46+nameLength+extraLength+commentLength;
      if(next>start+size||!nameLength||flags&1||![0,8].includes(method)||compressed===0xffffffff||expanded===0xffffffff||local===0xffffffff||expanded>MAX_ENTRY||(total+=expanded)>MAX_TOTAL)throw new Error('Office archive exceeds safety limits or is encrypted.');
      let name;try{name=decoder.decode(bytes.subarray(offset+46,offset+46+nameLength));}catch{throw new Error('Invalid Office archive path.');}
      if(name.startsWith('/')||name.includes('\\')||name.includes('\0')||name.split('/').some(part=>part==='..'||part==='.')||names.has(name))throw new Error('Unsafe or duplicate Office archive path.');names.add(name);
      if(local+30>start||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method)throw new Error('Invalid Office archive entry.');
      const localName=u16(local+26),localExtra=u16(local+28),dataStart=local+30+localName+localExtra;
      if(localName!==nameLength||dataStart+compressed>start)throw new Error('Invalid Office archive entry size.');
      for(let j=0;j<nameLength;j++)if(bytes[local+30+j]!==bytes[offset+46+j])throw new Error('Office archive filenames do not match.');
      entries.push({name,method,compressed,expanded,dataStart});offset=next;
    }
    if(offset!==start+size)throw new Error('Invalid Office archive directory size.');
    return {count,uncompressedBytes:total,names:[...names],entries};
  }
  function verify(buffer,manifest,fflate){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);let total=0;
    for(const entry of manifest.entries){let actual=0;
      const accept=chunk=>{actual+=chunk.length;total+=chunk.length;if(actual>entry.expanded||actual>MAX_ENTRY||total>MAX_TOTAL)throw new Error('Office archive exceeds decompression limits.');};
      if(entry.method===0)accept(bytes.subarray(entry.dataStart,entry.dataStart+entry.compressed));
      else {const inflater=new fflate.Inflate(accept),end=entry.dataStart+entry.compressed;try{if(entry.compressed===0)inflater.push(new Uint8Array(),true);else for(let at=entry.dataStart;at<end;at+=4096)inflater.push(bytes.subarray(at,Math.min(end,at+4096)),at+4096>=end);}catch(error){if(/limits/.test(error.message))throw error;throw new Error('Office archive has invalid compressed data.');}}
      if(actual!==entry.expanded)throw new Error('Office archive size does not match its contents.');
    }
    return true;
  }
  return {inspect,verify,MAX_INPUT,MAX_TOTAL};
});
