'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SoundSettings=api;})(typeof globalThis==='object'?globalThis:this,function(){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function object(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new Error('Invalid '+label+'.');}
  function number(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('Invalid '+label+'.');return value;}
  function settings(input){
    object(input,['gain','fadeIn','fadeOut','normalizeTarget','eqLow','eqMid','eqHigh','compressor','threshold','ratio','noiseGate','noiseThreshold','noiseReduction','limiter','ceiling'],'processing settings');
    if(typeof input.compressor!=='boolean'||(input.noiseGate!==undefined&&typeof input.noiseGate!=='boolean')||(input.limiter!==undefined&&typeof input.limiter!=='boolean'))throw new Error('Invalid dynamics state.');
    return {gain:number(input.gain,0,3,'gain'),fadeIn:number(input.fadeIn,0,600,'fade in'),fadeOut:number(input.fadeOut,0,600,'fade out'),normalizeTarget:number(input.normalizeTarget,-24,0,'normalize target'),eqLow:number(input.eqLow,-12,12,'low EQ'),eqMid:number(input.eqMid,-12,12,'mid EQ'),eqHigh:number(input.eqHigh,-12,12,'high EQ'),compressor:input.compressor,threshold:number(input.threshold,-60,0,'compressor threshold'),ratio:number(input.ratio,1,20,'compressor ratio'),noiseGate:input.noiseGate??false,noiseThreshold:number(input.noiseThreshold??-45,-80,-10,'noise threshold'),noiseReduction:number(input.noiseReduction??24,0,36,'noise reduction'),limiter:input.limiter??false,ceiling:number(input.ceiling??-1,-24,0,'limiter ceiling')};
  }
  function link(input){object(input,['sourceAssetId','processing'],'SoundRoom link');if(typeof input.sourceAssetId!=='string'||!uuid.test(input.sourceAssetId))throw new Error('Invalid SoundRoom source media ID.');return {sourceAssetId:input.sourceAssetId,processing:settings(input.processing)};}
  return {settings,link};
});
