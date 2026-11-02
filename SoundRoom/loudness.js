'use strict';
// ITU-R BS.1770 K-weighting and two-stage gating for 48 kHz mono/stereo PCM.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SoundLoudness=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  const rate=48000,windowSize=19200,hop=4800,maxFrames=rate*60;
  function filter(b,a){let s1=0,s2=0;return x=>{const y=b[0]*x+s1;s1=b[1]*x-a[1]*y+s2;s2=b[2]*x-a[2]*y;return y;};}
  function measure(channels){
    if(!Array.isArray(channels)||channels.length<1||channels.length>2||!channels.every(data=>data&&data.length===channels[0].length))throw new Error('Loudness analysis supports mono or stereo audio.');
    const frames=channels[0].length;if(frames<windowSize)throw new Error('Loudness analysis needs at least 0.4 seconds.');if(frames>maxFrames)throw new Error('Loudness analysis is limited to 60 seconds.');
    const filters=channels.map(()=>[filter([1.53512485958697,-2.69169618940638,1.19839281085285],[1,-1.69065929318241,.73248077421585]),filter([1,-2,1],[1,-1.99004745483398,.99007225036621])]);
    const ring=new Float64Array(windowSize),blocks=[];let sum=0;
    for(let i=0;i<frames;i++){let energy=0;for(let ch=0;ch<channels.length;ch++){const sample=channels[ch][i];if(!Number.isFinite(sample))throw new Error('Audio contains an invalid sample.');const value=filters[ch][1](filters[ch][0](sample));energy+=value*value;}const slot=i%windowSize;sum+=energy-ring[slot];ring[slot]=energy;if(i+1>=windowSize&&(i+1-windowSize)%hop===0)blocks.push(Math.max(0,sum/windowSize));}
    const db=energy=>-.691+10*Math.log10(energy),absolute=blocks.filter(energy=>energy>0&&db(energy)>-70);
    if(!absolute.length)return {integrated_lufs:null,blocks:blocks.length,gated_blocks:0};
    const mean=absolute.reduce((a,b)=>a+b,0)/absolute.length,threshold=Math.max(-70,db(mean)-10),gated=absolute.filter(energy=>db(energy)>threshold),integrated=db(gated.reduce((a,b)=>a+b,0)/gated.length);
    return {integrated_lufs:Math.round(integrated*100)/100,blocks:blocks.length,gated_blocks:gated.length};
  }
  return {rate,maxFrames,measure};
});
