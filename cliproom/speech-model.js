'use strict';
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');

// Fixed, checksum-verified assets; installing never sends audio to these hosts.
const revision='5332fcc35e32a33b86612b9a57a89be7906102b1';
const model='https://huggingface.co/Xenova/whisper-tiny/resolve/'+revision+'/';
const runtime='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
const entries=[
  ['runtime/transformers.min.js',runtime+'transformers.min.js',888173,'sha256','aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa'],
  ['runtime/ort-wasm-simd-threaded.jsep.mjs',runtime+'ort-wasm-simd-threaded.jsep.mjs',44484,'sha256','08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9'],
  ['runtime/ort-wasm-simd-threaded.jsep.wasm',runtime+'ort-wasm-simd-threaded.jsep.wasm',21596019,'sha256','c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'],
  ...[
    ['config.json',2248,'dea913aa8ec7d53db029e97c97a766d534c8da04'],
    ['generation_config.json',3716,'72e54ad7340e05287aa731f9d8556b5368be3fe0'],
    ['preprocessor_config.json',339,'91876762a536a746d268353c5cba57286e76b058'],
    ['tokenizer.json',2480466,'1e95340ff836fad1b5932e800fb7b8c5e6d78a74'],
    ['tokenizer_config.json',282683,'d13b786c04765fb1a06492b53587752cd67665ea']
  ].map(([name,size,digest])=>['models/Xenova/whisper-tiny/'+name,model+name,size,'gitsha1',digest]),
  ['models/Xenova/whisper-tiny/onnx/encoder_model_quantized.onnx',model+'onnx/encoder_model_quantized.onnx',10124910,'sha256','fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e'],
  ['models/Xenova/whisper-tiny/onnx/decoder_model_merged_quantized.onnx',model+'onnx/decoder_model_merged_quantized.onnx',30727765,'sha256','6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0']
].map(([name,url,size,algorithm,digest])=>({name,url,size,algorithm,digest}));
const totalBytes=entries.reduce((sum,item)=>sum+item.size,0);
function fail(status,message){return Object.assign(new Error(message),{status});}
function createSpeechModel({directory,manifest=entries,fetchImpl=fetch}){
  const root=path.resolve(directory),final=path.join(root,'v1'),allowed=new Map(manifest.map(item=>[item.name,item]));
  const total=manifest.reduce((sum,item)=>sum+item.size,0),verified=new Map();let active=null,stateCheck=null;
  async function verify(target,item,stat){const signature=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');if(verified.get(target)===signature)return;const digest=crypto.createHash(item.algorithm==='gitsha1'?'sha1':item.algorithm);if(item.algorithm==='gitsha1')digest.update('blob '+item.size+'\0');for await(const chunk of fs.createReadStream(target))digest.update(chunk);if(digest.digest('hex')!==item.digest)throw new Error('A speech model file failed its integrity check.');verified.set(target,signature);}
  async function checkState(){
    let finalExists=false;
    try{
      const rootStat=await fsp.lstat(root),finalStat=await fsp.lstat(final);finalExists=true;if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||!finalStat.isDirectory()||finalStat.isSymbolicLink())throw new Error('Invalid speech model directory.');
      const markerFile=path.join(final,'installed.json'),markerStat=await fsp.lstat(markerFile);if(!markerStat.isFile()||markerStat.isSymbolicLink()||markerStat.size>4096)throw new Error('Invalid speech model marker.');const marker=JSON.parse(await fsp.readFile(markerFile,'utf8'));if(marker.version!==1||marker.total!==total||marker.revision!==revision)throw new Error('Invalid speech model marker.');
      for(const item of manifest){const target=path.join(final,...item.name.split('/')),relative=path.relative(final,target);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Invalid speech model path.');let dir=path.dirname(target);while(dir!==final){const stat=await fsp.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Invalid speech model directory.');dir=path.dirname(dir);}const stat=await fsp.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.size)throw new Error('A speech model file is missing or damaged.');await verify(target,item,stat);}
      return {installed:true,bytes:total,revision};
    }catch(error){if(error.code==='ENOENT'&&!finalExists)return {installed:false,bytes:total,...(active?{downloading:true,downloaded:active.downloaded,current:active.current}:{})};return {installed:false,invalid:true,bytes:total,error:'The existing speech model is incomplete or damaged.'};}
  }
  async function state(){if(stateCheck)return stateCheck;const pending=checkState();stateCheck=pending;try{return await pending;}finally{if(stateCheck===pending)stateCheck=null;}}
  async function install(signal){
    if(active)throw fail(429,'The local speech model is already downloading.');active={downloaded:0,current:''};let stage,committed=false;
    try{
      const previous=await state();if(previous.installed)return {...previous,already_installed:true};if(previous.invalid)throw fail(409,'The existing speech model is damaged. Back it up or remove the speech-model/v1 directory before reinstalling.');
      await fsp.mkdir(root,{recursive:true});const rootStat=await fsp.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw fail(400,'Invalid speech model directory.');stage=await fsp.mkdtemp(path.join(root,'install-'));
      for(const item of manifest){
        active.current=item.name;const target=path.join(stage,...item.name.split('/')),relative=path.relative(stage,target);if(relative.startsWith('..')||path.isAbsolute(relative))throw fail(400,'Invalid speech model path.');await fsp.mkdir(path.dirname(target),{recursive:true});
        const response=await fetchImpl(item.url,{signal});if(!response.ok||!response.body)throw fail(502,'Could not download the local speech model ('+response.status+').');
        const digest=crypto.createHash(item.algorithm==='gitsha1'?'sha1':item.algorithm);if(item.algorithm==='gitsha1')digest.update('blob '+item.size+'\0');let size=0;
        const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;active.downloaded+=chunk.length;if(size>item.size)return callback(fail(502,'A speech model file exceeded its expected size.'));digest.update(chunk);callback(null,chunk);}});
        await pipeline(Readable.fromWeb(response.body),limit,fs.createWriteStream(target,{flags:'wx',mode:0o600}),{signal});
        if(size!==item.size||digest.digest('hex')!==item.digest)throw fail(502,'A speech model file failed its integrity check.');
      }
      if(signal?.aborted)throw Object.assign(new Error('Speech model download cancelled.'),{name:'AbortError'});
      await fsp.writeFile(path.join(stage,'installed.json'),JSON.stringify({version:1,total,revision}),{flag:'wx',mode:0o600});
      if(signal?.aborted)throw Object.assign(new Error('Speech model download cancelled.'),{name:'AbortError'});
      try{await fsp.lstat(final);throw fail(409,'The speech model directory appeared during installation.');}catch(error){if(error.code!=='ENOENT')throw error;}
      const realRoot=await fsp.realpath(root),realStage=await fsp.realpath(stage),realFinal=path.join(realRoot,'v1');if(path.dirname(realStage)!==realRoot||!path.basename(realStage).startsWith('install-')||path.dirname(realFinal)!==realRoot)throw fail(400,'Invalid speech model staging directory.');
      await fsp.rename(realStage,realFinal);committed=true;return {installed:true,bytes:total,revision,already_installed:false};
    }finally{
      active=null;
      if(stage&&!committed)try{const realRoot=await fsp.realpath(root),stat=await fsp.lstat(stage),realStage=await fsp.realpath(stage);if(stat.isDirectory()&&!stat.isSymbolicLink()&&path.dirname(realStage)===realRoot&&path.basename(realStage).startsWith('install-'))await fsp.rm(realStage,{recursive:true,force:true});}catch{}
    }
  }
  async function file(name){if(!allowed.has(name))throw fail(404,'Speech model file not found.');const current=await state();if(!current.installed)throw fail(404,'The local speech model is not installed.');return path.join(final,...name.split('/'));}
  return {state,install,file,total};
}
module.exports={createSpeechModel,entries,totalBytes,revision};
