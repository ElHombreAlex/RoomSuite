import {pipeline,env} from '/api/speech/files/runtime/transformers.min.js';

env.allowRemoteModels=false;
env.allowLocalModels=true;
env.localModelPath='/api/speech/files/models/';
env.useBrowserCache=false;
env.backends.onnx.wasm.wasmPaths='/api/speech/files/runtime/';
env.backends.onnx.wasm.numThreads=1;
env.backends.onnx.wasm.proxy=false;

self.onmessage=async event=>{
  try{
    self.postMessage({type:'progress',message:'Loading the local speech model…'});
    const transcriber=await pipeline('automatic-speech-recognition','Xenova/whisper-tiny',{device:'wasm',dtype:'q8',local_files_only:true});
    self.postMessage({type:'progress',message:'Recognizing speech on this device…'});
    const options={task:'transcribe',return_timestamps:true};if(event.data.language!=='auto')options.language=event.data.language;
    const result=await transcriber(new Float32Array(event.data.samples),options);
    self.postMessage({type:'result',result:{text:result.text,chunks:result.chunks}});
    await transcriber.dispose();
  }catch(error){self.postMessage({type:'error',message:error?.message||'Local speech recognition failed.'});}
};
