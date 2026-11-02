import fs from 'node:fs/promises';
import { inputPath } from './files.mjs';
import Waveform from '../cliproom/public/waveform.js';
import { withRoom } from './rooms.mjs';

export async function analyzeWaveform(args,signal){
  if(!!args.input===!!args.asset_id)throw new Error('Provide exactly one workspace input or Cliproom asset_id.');
  let file;
  if(args.input){file=await inputPath(args.input);const stat=await fs.stat(file);if(stat.size>Waveform.maxBytes)throw new Error('Media must be 20 MiB or smaller for waveform analysis.');}
  return withRoom('/cliproom/','Cliproom',signal,async page=>{
    if(file){await page.evaluate(()=>{const input=document.createElement('input');input.id='waveform-probe';input.type='file';document.body.append(input);});await page.locator('#waveform-probe').setInputFiles(file);}
    return page.evaluate(async({bins,assetId})=>{
      let mediaFile;
      if(assetId){const response=await fetch('/api/assets/'+encodeURIComponent(assetId));if(!response.ok)throw new Error('Cliproom media could not be loaded.');const type=String(response.headers.get('content-type')||'').split(';')[0];if(!/^(audio|video)\//.test(type))throw new Error('Choose an audio or video asset.');mediaFile=new Blob([await RoomWaveform.readResponse(response)],{type});}
      else mediaFile=document.querySelector('#waveform-probe').files[0];
      if(!/^(audio|video)\//.test(mediaFile.type))throw new Error('Choose an audio or video file.');
      const video=mediaFile.type.startsWith('video/'),url=URL.createObjectURL(mediaFile),media=document.createElement(video?'video':'audio');media.preload='metadata';media.src=url;
      try{
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Media metadata timed out.')),20000);media.onloadedmetadata=()=>{clearTimeout(timer);resolve();};media.onerror=()=>{clearTimeout(timer);reject(new Error('This browser cannot read the media.'));};});
        if(!Number.isFinite(media.duration)||media.duration>RoomWaveform.maxSeconds)throw new Error('Waveform analysis supports media up to 3 minutes.');
        const Decoder=window.AudioContext||window.webkitAudioContext;if(!Decoder)throw new Error('Audio decoding is unavailable in this browser.');const decoder=new Decoder();
        try{
          let audio;try{audio=await decoder.decodeAudioData(await mediaFile.arrayBuffer());}catch{throw new Error('No decodable audio track is available in this browser.');}
          if(audio.duration>RoomWaveform.maxSeconds||audio.numberOfChannels>8)throw new Error('Audio exceeds the waveform duration or channel limit.');
          return {duration_seconds:audio.duration,sample_rate:audio.sampleRate,channels:audio.numberOfChannels,peaks:RoomWaveform.peaks(Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i)),bins),note:'Peak absolute amplitude per time interval, combined across channels; not loudness.'+(video?' Video track timing is approximate and depends on browser decoding.':'')};
        }finally{await decoder.close();}
      }finally{media.removeAttribute('src');media.load();URL.revokeObjectURL(url);}
    },{bins:args.bins||256,assetId:args.asset_id});
  });
}
