import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import Timeline from '../cliproom/public/timeline.js';
import Region from '../cliproom/public/region-grade.js';
import {inputPath} from './files.mjs';
import {serverUrl,withRoom} from './rooms.mjs';

export async function setClipMask(args,signal){
  if(args.action==='set'&&!args.mask_path)throw new Error('Provide a workspace mask_path.');
  if(args.action==='remove'&&(args.mask_path!==undefined||args.channel!==undefined))throw new Error('mask_path and channel apply only when setting a mask.');
  const origin=serverUrl(),route='/api/projects/'+encodeURIComponent(args.project_id),response=await fetch(origin+route,{signal}),project=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(project.error||'Could not read the Cliproom project.'),{status:response.status});
  if(project.revision!==args.base_revision)throw Object.assign(new Error('This project changed. Read its latest revision before editing.'),{status:409});
  const state=Timeline.migrate(structuredClone(project.state),()=>crypto.randomUUID()),matches=state.clips.filter(item=>item?.id===args.clip_id);if(matches.length!==1)throw new Error('The clip ID must identify exactly one picture clip.');
  const clip=matches[0],source=state.assets.find(item=>item.id===clip.assetId);if(!source||!['image','video'].includes(source.kind))throw new Error('The clip source is missing or is not a picture.');
  const before=clip.gradeMask?{width:clip.gradeMask.width,height:clip.gradeMask.height}:null,old=JSON.stringify(clip.gradeMask??null);
  if(args.action==='remove')delete clip.gradeMask;
  else{
    const file=await inputPath(args.mask_path),stat=await fs.stat(file);if(stat.size>20*1024*1024)throw new Error('Mask images must be at most 20 MiB.');
    clip.gradeMask=await withRoom('/cliproom/','Cliproom',signal,async page=>{await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='mcpClipMaskProbe';document.body.append(input);});await page.locator('#mcpClipMaskProbe').setInputFiles(file);return page.evaluate(async channel=>{const file=document.querySelector('#mcpClipMaskProbe').files[0];if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG or WebP mask.');const image=await createImageBitmap(file);try{return ClipRegionGrade.fromImage(image,channel);}finally{image.close();}},args.channel||'luminance');});
    if(!Region.compatible(clip.gradeMask.width,clip.gradeMask.height,source.width,source.height))throw new Error('The mask must match the source picture’s aspect ratio.');
  }
  Region.validateProject(state.clips);const changed=old!==JSON.stringify(clip.gradeMask??null);if(changed&&clip.gradeMask)state.version=5;
  const after=clip.gradeMask?{width:clip.gradeMask.width,height:clip.gradeMask.height}:null,result={project_id:project.id,revision:project.revision,clip_id:clip.id,dry_run:!!args.dry_run,changed,before,after};
  if(Buffer.byteLength(JSON.stringify({baseRevision:project.revision,state}))>2*1024*1024)throw new Error('The mask would exceed the 2 MiB project save limit. Use a simpler mask.');
  if(args.dry_run||!changed)return result;
  const saved=await fetch(origin+route,{method:'PUT',signal,headers:{Origin:origin,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:project.revision,state})}),body=await saved.json().catch(()=>({}));
  if(!saved.ok)throw Object.assign(new Error(body.error||'Could not save the Cliproom project.'),{status:saved.status});return {...result,dry_run:false,revision:body.revision};
}
