'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PixelLayerMask=api;})(typeof globalThis==='object'?globalThis:this,function(){
  const maxDimension=2048,maxPixels=4000000,maxBytes=16*1024*1024,prefix='data:image/png;base64,';
  function dimensions(width,height){if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>maxDimension||height>maxDimension||width*height>maxPixels)throw new Error('Masks must be at most 2,048 pixels per side and 4 megapixels.');}
  function validate(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['version','width','height','image'].includes(key))||input.version!==1)throw new Error('Invalid layer mask.');
    dimensions(input.width,input.height);const value=input.image;
    if(typeof value!=='string'||!value.startsWith(prefix))throw new Error('Layer masks must be embedded PNG images.');const data=value.slice(prefix.length);
    if(!data||data.length%4||data.length*3/4-(data.endsWith('==')?2:data.endsWith('=')?1:0)>maxBytes||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new Error('Invalid or oversized layer mask.');
    let header;try{header=atob(data.slice(0,32));}catch{throw new Error('Invalid layer mask PNG.');}if(header.length<24||[137,80,78,71,13,10,26,10].some((n,i)=>header.charCodeAt(i)!==n)||header.slice(12,16)!=='IHDR')throw new Error('Invalid layer mask PNG.');
    const number=offset=>((header.charCodeAt(offset)*16777216)+(header.charCodeAt(offset+1)<<16)+(header.charCodeAt(offset+2)<<8)+header.charCodeAt(offset+3));if(number(16)!==input.width||number(20)!==input.height)throw new Error('Layer mask dimensions do not match its PNG.');
    return {version:1,width:input.width,height:input.height,image:value};
  }
  function compatible(maskWidth,maskHeight,sourceWidth,sourceHeight){return Number.isFinite(sourceWidth)&&Number.isFinite(sourceHeight)&&sourceWidth>0&&sourceHeight>0&&Math.abs(maskWidth/maskHeight/(sourceWidth/sourceHeight)-1)<.01;}
  function fromImage(image,channel){if(!['alpha','luminance'].includes(channel))throw new Error('Choose mask transparency or brightness.');const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;dimensions(width,height);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);const pixels=context.getImageData(0,0,width,height),data=pixels.data;for(let i=0;i<data.length;i+=4){const alpha=data[i+3],value=channel==='alpha'?alpha:Math.round((.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])*alpha/255);data[i]=data[i+1]=data[i+2]=255;data[i+3]=value;}context.putImageData(pixels,0,0);return canvas;}
  function encode(canvas){return validate({version:1,width:canvas.width,height:canvas.height,image:canvas.toDataURL('image/png')});}
  return {maxDimension,maxPixels,maxBytes,dimensions,validate,compatible,fromImage,encode};
});
