'use strict';
// Portable, self-contained edited PCM and non-destructive processing settings.
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('../cliproom/public/sound-settings.js'):root.SoundSettings);if(typeof module==='object'&&module.exports)module.exports=api;else root.SoundSession=api;})(typeof globalThis==='object'?globalThis:this,function(SoundSettings){
  const maxBytes=32*1024*1024,maxPcmBytes=24*1024*1024-4096;
  function object(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new Error('Invalid '+label+'.');}
  function number(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('Invalid '+label+'.');return value;}
  const settings=SoundSettings.settings;
  function fromBytes(bytes){const parts=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(parts.join(''));}
  function toBytes(encoded,size){const padding=(3-size%3)%3;if(typeof encoded!=='string'||encoded.length!==Math.ceil(size/3)*4||/[^A-Za-z0-9+/=]/.test(encoded)||encoded.indexOf('=')!==(padding?encoded.length-padding:-1)||!encoded.endsWith('='.repeat(padding)))throw new Error('Invalid embedded audio.');let data;try{data=atob(encoded);}catch{throw new Error('Invalid embedded audio.');}if(data.length!==size)throw new Error('Embedded audio has the wrong length.');const bytes=new Uint8Array(size);for(let i=0;i<size;i++)bytes[i]=data.charCodeAt(i);return bytes;}
  function encode(buffer,title,processing,cursor,selection,markers){
    const channels=buffer.numberOfChannels,frames=buffer.length,rate=buffer.sampleRate,size=frames*channels*4;
    if(!Number.isInteger(channels)||channels<1||channels>8||!Number.isInteger(rate)||rate<8000||rate>192000||!Number.isInteger(frames)||frames<1)throw new Error('This audio has unsupported session dimensions.');
    if(size>maxPcmBytes)throw new Error('This audio is too large for a self-contained session. Export a WAV or use a shorter clip.');
    const bytes=new Uint8Array(size),view=new DataView(bytes.buffer),source=Array.from({length:channels},(_,ch)=>buffer.getChannelData(ch));let offset=0;
    for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++){const sample=source[ch][i];if(!Number.isFinite(sample)||Math.abs(sample)>16)throw new Error('Audio contains an unsupported sample.');view.setFloat32(offset,sample,true);offset+=4;}
    const project={format:'soundroom-project',version:1,title,audio:{sampleRate:rate,channels,frames,data:fromBytes(bytes)},processing,cursor,selection,markers};
    const text=JSON.stringify(project);if(new TextEncoder().encode(text).length>maxBytes)throw new Error('This session exceeds 32 MiB.');return text;
  }
  function decode(text){
    if(typeof text!=='string'||new TextEncoder().encode(text).length>maxBytes)throw new Error('Session files must be 32 MiB or smaller.');
    let project;try{project=JSON.parse(text);}catch{throw new Error('Session is not valid JSON.');}
    object(project,['format','version','title','audio','processing','cursor','selection','markers'],'session');if(project.format!=='soundroom-project'||project.version!==1)throw new Error('Unsupported SoundRoom session version.');
    if(typeof project.title!=='string'||!project.title.length||project.title.length>80||/[\x00-\x1f\x7f]/.test(project.title))throw new Error('Invalid session title.');
    const audio=project.audio;object(audio,['sampleRate','channels','frames','data'],'session audio');const rate=number(audio.sampleRate,8000,192000,'sample rate'),channels=number(audio.channels,1,8,'channel count'),frames=number(audio.frames,1,maxPcmBytes/4,'frame count');if(!Number.isInteger(rate)||!Number.isInteger(channels)||!Number.isInteger(frames)||frames*channels*4>maxPcmBytes)throw new Error('Invalid embedded audio dimensions.');
    const duration=frames/rate,cursor=number(project.cursor,0,duration,'playhead');let selection=project.selection;if(selection!==null){if(!Array.isArray(selection)||selection.length!==2)throw new Error('Invalid selection.');selection=selection.map(value=>number(value,0,duration,'selection'));if(selection[0]>=selection[1])throw new Error('Invalid selection.');}
    if(!Array.isArray(project.markers)||project.markers.length>10000)throw new Error('Invalid split markers.');const markers=project.markers.map(value=>number(value,0,duration,'split marker'));if(markers.some((value,index)=>value<=0||value>=duration||(index&&value<=markers[index-1])))throw new Error('Invalid split markers.');
    const processing=settings(project.processing),bytes=toBytes(audio.data,frames*channels*4),view=new DataView(bytes.buffer),samples=Array.from({length:channels},()=>new Float32Array(frames));let offset=0;
    for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++){const sample=view.getFloat32(offset,true);if(!Number.isFinite(sample)||Math.abs(sample)>16)throw new Error('Embedded audio contains an unsupported sample.');samples[ch][i]=sample;offset+=4;}
    return {title:project.title,sampleRate:rate,channels,frames,samples,processing,cursor,selection,markers};
  }
  return {maxBytes,maxPcmBytes,settings,encode,decode};
});
