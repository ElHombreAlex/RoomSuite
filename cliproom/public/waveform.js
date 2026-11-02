'use strict';
(function (root,factory) {
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.RoomWaveform=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  const maxBytes=20*1024*1024,maxSeconds=180,maxBins=512;
  async function readResponse(response){
    if(!response.ok)throw new Error('Media could not be loaded.');
    if(Number(response.headers.get('content-length')||0)>maxBytes){await response.body?.cancel().catch(()=>{});throw new Error('Media exceeds the waveform size limit.');}
    if(!response.body)throw new Error('Media could not be read.');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new Error('Media exceeds the waveform size limit.');chunks.push(value);}}
    finally{await reader.cancel().catch(()=>{});}
    const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}return data.buffer;
  }
  // Peak amplitudes over time, combined across channels. Source samples are never modified.
  function peaks(channels,bins=maxBins){
    if(!Array.isArray(channels)||!channels.length||channels.length>8||!Number.isInteger(bins)||bins<1||bins>maxBins)throw new Error('Invalid waveform input.');
    const length=channels[0].length;if(!length||channels.some(channel=>channel.length!==length))throw new Error('Audio channels must have equal lengths.');
    const result=[];for(let bin=0;bin<bins;bin++){const start=Math.floor(bin*length/bins),end=Math.max(start+1,Math.floor((bin+1)*length/bins));let peak=0;
      for(const channel of channels)for(let i=start;i<Math.min(end,length);i++){const value=Math.abs(channel[i]);if(Number.isFinite(value)&&value>peak)peak=value;}
      result.push(Math.min(1,Math.round(peak*10000)/10000));}
    return result;
  }
  function segment(values,duration,start,end,bins=256){
    if(!Array.isArray(values)||!values.length||!(duration>0)||!(end>start)||!Number.isInteger(bins)||bins<1||bins>maxBins)throw new Error('Invalid waveform segment.');
    const result=[];for(let i=0;i<bins;i++){const a=Math.max(0,Math.min(values.length-1,Math.floor((start+(end-start)*i/bins)/duration*values.length))),b=Math.max(a+1,Math.min(values.length,Math.ceil((start+(end-start)*(i+1)/bins)/duration*values.length)));let peak=0;for(let j=a;j<b;j++)peak=Math.max(peak,values[j]||0);result.push(peak);}return result;
  }
  return {maxBytes,maxSeconds,maxBins,peaks,segment,readResponse};
});
