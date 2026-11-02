'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SoundNoiseGate=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  const maxSamples=6000000;
  // A linked-channel expander reduces quiet sections. It is not a spectral
  // speech denoiser; noise under louder signals remains audible.
  function apply(channels,rate,thresholdDb,reductionDb){
    if(!Array.isArray(channels)||channels.length<1||channels.length>2||!Number.isInteger(rate)||rate<8000||rate>192000||!Number.isFinite(thresholdDb)||thresholdDb< -80||thresholdDb> -10||!Number.isFinite(reductionDb)||reductionDb<0||reductionDb>36||channels.some(c=>!(c instanceof Float32Array)||!c.length||c.length!==channels[0].length)||channels[0].length*channels.length>maxSamples)throw new Error('Noise gate supports mono/stereo audio with at most 6 million samples.');
    const threshold=Math.pow(10,thresholdDb/10),floor=Math.pow(10,-reductionDb/20),detectAttack=Math.exp(-1/(rate*.01)),detectRelease=Math.exp(-1/(rate*.08)),open=Math.exp(-1/(rate*.005)),close=Math.exp(-1/(rate*.15));let level=0,gain=1;
    for(let i=0;i<channels[0].length;i++){let peak=0;for(const channel of channels){const sample=channel[i];if(!Number.isFinite(sample))throw new Error('Audio contains an invalid sample.');peak=Math.max(peak,Math.abs(sample));}const power=peak*peak,detector=power>level?detectAttack:detectRelease;level=detector*level+(1-detector)*power;const target=level>=threshold?1:floor,coefficient=target>gain?open:close;gain=coefficient*gain+(1-coefficient)*target;for(const channel of channels)channel[i]*=gain;}
    return channels;
  }
  return {apply,maxSamples};
});
