'use strict';
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./layer-mask'):root.PixelLayerMask);if(typeof module==='object'&&module.exports)module.exports=api;else root.ClipRegionGrade=api;})(typeof globalThis==='object'?globalThis:this,function(Mask){
  const maxSide=1024,maxPixels=1024*1024;
  const validated=new WeakMap();let buffers;
  const crcTable=Uint32Array.from({length:256},(_,value)=>{let crc=value;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;});
  function checkPng(image){
    const encoded=image.slice('data:image/png;base64,'.length);if(encoded.length>2*1024*1024)throw new Error('The embedded color mask is too large.');let bytes;try{bytes=atob(encoded);}catch{throw new Error('Invalid color mask PNG.');}
    const u32=at=>((bytes.charCodeAt(at)*0x1000000)+(bytes.charCodeAt(at+1)<<16)+(bytes.charCodeAt(at+2)<<8)+bytes.charCodeAt(at+3))>>>0;
    let at=8,index=0,foundData=false,finished=false;while(at+12<=bytes.length){const length=u32(at),type=bytes.slice(at+4,at+8),end=at+12+length;if(end>bytes.length||!/^[-A-Za-z]{4}$/.test(type))throw new Error('Invalid color mask PNG chunk.');if(index===0&&(type!=='IHDR'||length!==13)||index>0&&type==='IHDR')throw new Error('Invalid color mask PNG header.');let crc=0xffffffff;for(let i=at+4;i<at+8+length;i++)crc=crcTable[(crc^bytes.charCodeAt(i))&255]^(crc>>>8);if(((crc^0xffffffff)>>>0)!==u32(at+8+length))throw new Error('Color mask PNG failed its integrity check.');if(type==='IDAT')foundData=foundData||length>0;if(type==='IEND'){if(length!==0||end!==bytes.length||!foundData)throw new Error('Invalid color mask PNG ending.');finished=true;break;}at=end;index++;}if(!finished)throw new Error('Color mask PNG is incomplete.');
  }
  function validate(value){
    const cached=value&&typeof value==='object'?validated.get(value):null;
    if(cached&&value.version===1&&value.width===cached.width&&value.height===cached.height&&value.image===cached.image&&Object.keys(value).length===4)return cached;
    const mask=Mask.validate(value);if(mask.width>maxSide||mask.height>maxSide||mask.width*mask.height>maxPixels)throw new Error('Clip color masks must be at most 1,024 pixels per side.');checkPng(mask.image);validated.set(value,mask);return mask;
  }
  function validateProject(clips){const seen=new Set();let pixels=0;for(const clip of clips||[])if(clip?.gradeMask!==undefined){const mask=validate(clip.gradeMask);if(!seen.has(mask.image)){seen.add(mask.image);pixels+=mask.width*mask.height;if(seen.size>16||pixels>4*maxPixels)throw new Error('A project supports up to 16 distinct color masks and 4 megapixels of masks.');}}}
  function fromImage(image,channel){const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;if(!width||!height||width*height>40000000)throw new Error('Choose a mask image of at most 40 megapixels.');const scale=Math.min(1,maxSide/Math.max(width,height)),small=document.createElement('canvas');small.width=Math.max(1,Math.round(width*scale));small.height=Math.max(1,Math.round(height*scale));small.getContext('2d').drawImage(image,0,0,small.width,small.height);return validate(Mask.encode(Mask.fromImage(small,channel)));}
  function render(source,mask,values,width,height,cacheable=false){
    width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));
    const [output,graded]=buffers||=( [document.createElement('canvas'),document.createElement('canvas')] );if(output.width!==width||output.height!==height){output.width=graded.width=width;output.height=graded.height=height;}
    const base=output.getContext('2d'),top=graded.getContext('2d');base.globalCompositeOperation='source-over';base.clearRect(0,0,width,height);top.globalCompositeOperation='source-over';top.clearRect(0,0,width,height);base.drawImage(source,0,0,width,height);base.globalCompositeOperation='destination-out';base.drawImage(mask,0,0,width,height);
    if('filter'in top)top.filter=RoomGrade.cssFilter(values);top.drawImage(RoomGrade.renderSource(source,values,width,height,cacheable),0,0,width,height);if('filter'in top)top.filter='none';top.globalCompositeOperation='destination-in';top.drawImage(mask,0,0,width,height);
    base.globalCompositeOperation='lighter';base.drawImage(graded,0,0);return output;
  }
  return {maxSide,validate,validateProject,fromImage,compatible:Mask.compatible,render};
});
