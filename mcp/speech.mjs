import fs from 'node:fs/promises';
import path from 'node:path';
import {serverUrl,withRoom} from './rooms.mjs';
import {outputPath} from './files.mjs';
import Subtitles from '../cliproom/public/subtitles.js';

async function request(route,options={}){const response=await fetch(serverUrl()+route,options),body=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(body.error||'Cliproom request failed.'),{status:response.status});return body;}
export async function speechModelStatus(args,signal){return request('/api/speech/model',{signal});}
export async function installSpeechModel(args,signal,progress){await progress?.(5,100,'Downloading and verifying the optional local speech model…');const origin=serverUrl();return request('/api/speech/model',{method:'POST',signal,headers:{Origin:origin,'X-Cliproom-Request':'1'}});}
export async function transcribeClip(args,signal,progress){
  const model=await speechModelStatus({},signal);if(!model.installed)throw new Error('The local speech model is not installed. Use cliproom_install_speech_model first.');
  const route='/api/projects/'+encodeURIComponent(args.project_id),project=await request(route,{signal});if(project.revision!==args.base_revision)throw Object.assign(new Error('This project changed. Read the latest revision before transcribing.'),{code:'REVISION_CONFLICT',currentRevision:project.revision});
  const matches=[...(project.state.clips||[]),...(project.state.audioClips||[])].filter(item=>item.id===args.clip_id);if(matches.length!==1)throw new Error('The clip ID must identify one audio or video clip.');const clip=matches[0],asset=project.state.assets.find(item=>item.id===clip.assetId);if(!asset||!['audio','video'].includes(asset.kind))throw new Error('Choose an audio or video clip.');
  const out=args.output?await outputPath(args.output,['.srt','.vtt']):null;await progress?.(10,100,'Decoding the selected source and loading the local speech model…');
  const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)throw new Error('The request was cancelled.');signal?.addEventListener('abort',abort,{once:true});let lease,recognized;
  try{
    const origin=serverUrl();lease=await fetch(origin+'/api/speech/lease',{method:'POST',headers:{Origin:origin,'X-Cliproom-Request':'1'},signal:controller.signal});if(!lease.ok){const body=await lease.json().catch(()=>({}));throw Object.assign(new Error(body.error||'Could not reserve local transcription.'),{status:lease.status});}
    recognized=await withRoom('/cliproom/','Cliproom',signal,page=>page.evaluate(input=>ClipSpeech.recognize(input),{clip,asset,language:args.language||'auto'}));
  }finally{controller.abort();signal?.removeEventListener('abort',abort);await lease?.body?.cancel().catch(()=>{});}
  const latest=await request(route,{signal});if(latest.revision!==project.revision)throw Object.assign(new Error('This project changed while transcription was running. Read the latest revision and try again.'),{code:'REVISION_CONFLICT',currentRevision:latest.revision});
  const warnings=[...recognized.warnings,'Transcription uses this clip’s source range, without timeline volume, fades or other tracks.'];const result={project_id:project.id,revision:project.revision,clip_id:clip.id,language:args.language||'auto',cues:recognized.cues,warnings};
  if(out){const format=path.extname(out).slice(1).toLowerCase(),serialized=Subtitles.serialize(recognized.cues.map(cue=>({...cue,subtitle:true})),format),data=Buffer.from(serialized.text,'utf8');await fs.writeFile(out,data,{flag:'wx',mode:0o600});return {...result,path:out,bytes:data.length,mime_type:format==='srt'?'text/plain':'text/vtt'};}
  return result;
}
