'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Session=require('../SoundRoom/session.js');
const settings={gain:.75,fadeIn:.1,fadeOut:.2,normalizeTarget:-6,eqLow:4,eqMid:-3,eqHigh:2,compressor:true,threshold:-20,ratio:5};
const channels=[new Float32Array([0,.25,-.5,1]),new Float32Array([1,-.25,.75,0])];
const buffer={numberOfChannels:2,length:4,sampleRate:8000,getChannelData:index=>channels[index]};
test('a SoundRoom session round-trips the edited float audio and all controls',()=>{
  const text=Session.encode(buffer,'A session',settings,.0002,[.0001,.0003],[.00025]),result=Session.decode(text);
  assert.equal(result.title,'A session');assert.equal(result.sampleRate,8000);assert.deepEqual(result.processing,{...settings,noiseGate:false,noiseThreshold:-45,noiseReduction:24,limiter:false,ceiling:-1});assert.deepEqual(result.selection,[.0001,.0003]);assert.deepEqual(result.markers,[.00025]);
  for(let i=0;i<2;i++)assert.deepEqual([...result.samples[i]],[...channels[i]]);
});
test('sessions reject unsupported fields, corrupt audio and invalid dimensions without evaluating code',()=>{
  const source=JSON.parse(Session.encode(buffer,'Test',settings,0,null,[]));
  for(const mutate of [p=>p.version=9,p=>p.extra='x',p=>p.audio.frames=999999999,p=>p.audio.data='!!!!',p=>p.processing.threshold=-100,p=>p.processing.noiseGate='yes',p=>p.processing.ceiling=1,p=>p.markers=[.0003,.0002]]){const value=structuredClone(source);mutate(value);assert.throws(()=>Session.decode(JSON.stringify(value)));}
  assert.throws(()=>Session.encode({...buffer,length:Session.maxPcmBytes},'Too large',settings,0,null,[]),/too large/i);
});
