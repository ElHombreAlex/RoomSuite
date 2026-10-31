import { Input, ALL_FORMATS, BlobSource, Output, Mp4OutputFormat, BufferTarget, Conversion, Quality } from '/api/render/mediabunny.mjs';
import { registerAacEncoder } from '/api/render/aac-encoder.mjs';

let registered=false;
export function prepareMp4Audio() { if(!registered){registerAacEncoder();registered=true;} }
export async function convertMp4Audio(blob) {
  prepareMp4Audio();
  const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
  try {
    if(!await input.getPrimaryVideoTrack() || !await input.getPrimaryAudioTrack())throw new Error('The recording is missing its video or audio track.');
    const output=new Output({format:new Mp4OutputFormat(),target:new BufferTarget()});
    const conversion=await Conversion.init({input,output,video:{codec:'avc'},audio:{codec:'aac',quality:new Quality({bitrate:128000})},showWarnings:false});
    if(!conversion.isValid || conversion.discardedTracks.length)throw new Error('The browser could not preserve both video and audio during MP4 conversion.');
    await conversion.execute();
    if(!output.target.buffer?.byteLength)throw new Error('MP4 audio conversion produced an empty file.');
    return new Blob([output.target.buffer],{type:'video/mp4'});
  } finally { input.dispose(); }
}
