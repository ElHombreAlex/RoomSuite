import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inputPath, outputPath, saveResponse, saveDownload } from './files.mjs';
import { serverUrl, withRoom } from './rooms.mjs';
import PaintModel from '../PaintRoom/model.js';
import NotesLinks from '../NotesRoom/links.js';
import NotesMedia from '../NotesRoom/media.js';
import { attachPreview, previewOnPage } from './preview.mjs';
import { elementArray, updateArray } from './paint-schema.mjs';

async function request(route, { method='GET', body, signal, headers={} } = {}) {
  const origin=serverUrl(), response=await fetch(origin+route,{method,signal,headers:{...(method==='GET'?{}:{Origin:origin,'X-Cliproom-Request':'1'}),...headers},...(body===undefined?{}:{body}),...(body && typeof body.pipe==='function'?{duplex:'half'}:{})});
  if(!response.ok){const result=await response.json().catch(()=>({}));throw Object.assign(new Error(result.error || 'RoomSuite request failed ('+response.status+').'),{status:response.status});}
  return response;
}
async function json(route,method='GET',data,signal){return (await request(route,{method,signal,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})})).json();}
const query=(route,values)=>route+'?'+new URLSearchParams(values);
export async function listShared(args,signal){return json(query('/api/workspace/list',{path:args.path||''}),'GET',undefined,signal);}
export async function searchShared(args,signal){return json(query('/api/workspace/search',{q:args.query}),'GET',undefined,signal);}
export async function searchSharedContent(args,signal){return json(query('/api/workspace/search-content',{q:args.query,path:args.path||''}),'GET',undefined,signal);}
export async function previewShared(args,signal){
  const info=await json(query('/api/workspace/preview-info',{path:args.path}),'GET',undefined,signal);if(args.time_seconds!==undefined&&info.kind!=='video')throw new Error('time_seconds applies only to video previews.');if(args.max_dimension!==undefined&&!['image','video'].includes(info.kind))throw new Error('max_dimension applies only to image or video previews.');if(info.kind==='text')return info;
  return withRoom('/files/','Shared files',signal,async page=>{const output=await page.evaluate(async({file,kind,time,limit})=>{const url='/api/workspace/preview-data?'+new URLSearchParams({path:file});let media;if(kind==='image'){media=new Image();media.src=url;await media.decode();}else{media=document.createElement(kind);media.muted=true;media.preload=kind==='video'?'auto':'metadata';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Media preview timed out.')),20000),done=()=>{clearTimeout(timer);resolve();},failed=()=>{clearTimeout(timer);reject(new Error('The browser cannot decode this media.'));};media.addEventListener(kind==='video'?'loadeddata':'loadedmetadata',done,{once:true});media.addEventListener('error',failed,{once:true});media.src=url;media.load();});}
      try{const duration=kind==='image'?null:Number.isFinite(media.duration)?media.duration:null;if(kind==='audio')return {duration_seconds:duration};const width=kind==='image'?media.naturalWidth:media.videoWidth,height=kind==='image'?media.naturalHeight:media.videoHeight;if(!width||!height||width*height>40000000)throw new Error('Preview dimensions must be at most 40 megapixels.');if(kind==='video'&&time>0){if(duration!==null&&time>=duration)throw new Error('Preview time must be inside the video.');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Video seek timed out.')),20000);media.onseeked=()=>{clearTimeout(timer);resolve();};media.onerror=()=>{clearTimeout(timer);reject(new Error('The video could not be seeked.'));};media.currentTime=time;});}const scale=Math.min(1,limit/Math.max(width,height));let canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));canvas.getContext('2d').drawImage(media,0,0,canvas.width,canvas.height);let encoded=canvas.toDataURL('image/png');while(encoded.length>1400000&&Math.max(canvas.width,canvas.height)>256){const smaller=document.createElement('canvas');smaller.width=Math.max(1,Math.round(canvas.width*.8));smaller.height=Math.max(1,Math.round(canvas.height*.8));smaller.getContext('2d').drawImage(canvas,0,0,smaller.width,smaller.height);canvas=smaller;encoded=canvas.toDataURL('image/png');}const data=encoded.slice(encoded.indexOf(',')+1),bytes=Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0);return {width,height,duration_seconds:duration,...(kind==='video'?{time_seconds:time}:{}),preview:{data,width:canvas.width,height:canvas.height,bytes,mime_type:'image/png'}};}finally{if(kind!=='image'){media.pause();media.removeAttribute('src');media.load();}}},{file:args.path,kind:info.kind,time:args.time_seconds||0,limit:args.max_dimension||1024});const {preview,...metadata}=output;return preview?attachPreview({...info,...metadata},preview):{...info,...metadata};});
}
export async function uploadShared(args,signal){const file=await inputPath(args.input),stat=await fs.stat(file);return (await request(query('/api/workspace/upload',{path:args.path}),{method:'POST',body:createReadStream(file),signal,headers:{'Content-Length':String(stat.size),'Content-Type':'application/octet-stream'}})).json();}
export async function downloadShared(args,signal){const ext=path.extname(args.output).toLowerCase(),out=await outputPath(args.output,[ext]),response=await request(query('/api/workspace/file',{path:args.path}),{signal});return saveResponse(response,out,'application/octet-stream',signal,{allowEmpty:true});}
export async function folderShared(args,signal){return json('/api/workspace/folder','POST',{path:args.path},signal);}
export async function moveShared(args,signal){return json('/api/workspace/move','POST',{from:args.from,to:args.to},signal);}
export async function deleteShared(args,signal){return json('/api/workspace/delete','POST',{path:args.path,recursive:args.recursive===true},signal);}
export async function trashShared(args,signal){return json('/api/workspace/trash','POST',{path:args.path,recursive:args.recursive===true},signal);}
export async function sharedReferences(args,signal){return json(query('/api/workspace/references',{path:args.path}),'GET',undefined,signal);}
export async function trashUnreferenced(args,signal){return json('/api/workspace/trash','POST',{path:args.path,require_unreferenced:true,base_revision:args.base_revision,confirm_unscanned:args.confirm_unscanned},signal);}
export async function listTrash(args,signal){return json('/api/workspace/trash','GET',undefined,signal);}
export async function restoreTrash(args,signal){return json('/api/workspace/trash/restore','POST',{id:args.id,...(args.to===undefined?{}:{to:args.to})},signal);}
export async function purgeTrash(args,signal){return json('/api/workspace/trash/purge','POST',{id:args.id},signal);}
export async function listHistory(args,signal){return json(args.path===undefined?'/api/workspace/history':query('/api/workspace/history',{path:args.path}),'GET',undefined,signal);}
export async function snapshotShared(args,signal){return json('/api/workspace/history','POST',{path:args.path},signal);}
export async function restoreVersion(args,signal){return json('/api/workspace/history/restore','POST',{id:args.id,to:args.to},signal);}
export async function deleteVersion(args,signal){return json('/api/workspace/history/delete','POST',{id:args.id,confirm:args.confirm===true},signal);}
export async function downloadVersion(args,signal){const ext=path.extname(args.output).toLowerCase(),out=await outputPath(args.output,[ext]),response=await request(query('/api/workspace/history/file',{id:args.id}),{signal});return saveResponse(response,out,'application/octet-stream',signal,{allowEmpty:true});}
export async function listNotes(args,signal){const q={};if(args.search)q.search=args.search;if(args.folder!==undefined)q.folder=args.folder;if(args.tag)q.tag=args.tag;return json(query('/api/notes',q),'GET',undefined,signal);}
export async function getNote(args,signal){return {note:await json('/api/notes/'+args.note_id,'GET',undefined,signal),url:serverUrl()+'/notesroom/?'+new URLSearchParams({note:args.note_id})};}
export async function createNote(args,signal){const note=await json('/api/notes','POST',{title:args.title,body:args.body||'',folder:args.folder||'',tags:args.tags||[]},signal);return {note,url:serverUrl()+'/notesroom/?'+new URLSearchParams({note:note.id})};}
export async function updateNote(args,signal){const old=await json('/api/notes/'+args.note_id,'GET',undefined,signal);const note=await json('/api/notes/'+args.note_id,'PUT',{baseRevision:args.base_revision,title:args.title??old.title,body:args.body??old.body,folder:args.folder??old.folder,tags:args.tags??old.tags},signal);return {note,url:serverUrl()+'/notesroom/?'+new URLSearchParams({note:note.id})};}
export async function deleteNote(args,signal){return json('/api/notes/'+args.note_id,'DELETE',{baseRevision:args.base_revision},signal);}
export async function noteLinks(args,signal){return json('/api/notes/'+args.note_id+'/links','GET',undefined,signal);}
export async function linkNote(args,signal){const old=await json('/api/notes/'+args.note_id,'GET',undefined,signal);if(old.revision!==args.base_revision)throw new Error('This note changed on another device. Reload it before saving.');const target=await json('/api/notes/'+args.target_note_id,'GET',undefined,signal),url=serverUrl()+'/notesroom/?'+new URLSearchParams({note:old.id}),links=NotesLinks.find(old.body);if(links.truncated)throw new Error('This note has too many links to safely add another.');if(links.ids.includes(target.id.toLowerCase()))return {note:old,url,changed:false};const addition=NotesLinks.marker(target.id,args.label||target.title),body=old.body+(old.body&&!old.body.endsWith('\n')?'\n\n':old.body?'\n':'')+addition;const note=await json('/api/notes/'+old.id,'PUT',{baseRevision:old.revision,title:old.title,body,folder:old.folder,tags:old.tags},signal);return {note,url,changed:true};}
export async function createNoteAttachment(args,signal){return json('/api/notes/attachments','POST',{path:args.path},signal);}
export async function auditNoteAttachments(args,signal){return json('/api/notes/attachments','GET',undefined,signal);}
export async function deleteNoteAttachment(args,signal){return json('/api/notes/attachments/'+args.attachment_id,'DELETE',{confirm_unsaved:args.confirm_unsaved},signal);}
async function checkedNote(args,signal){const old=await json('/api/notes/'+args.note_id,'GET',undefined,signal);if(old.revision!==args.base_revision)throw new Error('This note changed on another device. Reload it before saving.');return old;}
async function saveNoteMedia(old,body,signal){try{return await json('/api/notes/'+old.id,'PUT',{baseRevision:old.revision,title:old.title,body,folder:old.folder,tags:old.tags},signal);}catch(error){throw new Error(error.message+' Prepared media copies remain available for a safe retry.');}}
export async function attachNoteMedia(args,signal){const old=await checkedNote(args,signal),result=await createNoteAttachment(args,signal),info=result.attachment,type=info.mime_type.startsWith('image/')?'image':'audio',marker=NotesMedia.marker(type,args.path,info.id,args.label||args.path.split('/').pop()),body=old.body+(old.body&&!old.body.endsWith('\n')?'\n\n':old.body?'\n':'')+marker,note=await saveNoteMedia(old,body,signal);return {note,url:serverUrl()+'/notesroom/?'+new URLSearchParams({note:old.id}),attachment:info,already_exists:result.already_exists};}
export async function protectNoteMedia(args,signal){const old=await checkedNote(args,signal),parsed=NotesMedia.references(old.body),legacy=parsed.items.filter(item=>!item.attachment),paths=[...new Set(legacy.map(item=>item.path))],url=serverUrl()+'/notesroom/?'+new URLSearchParams({note:old.id});if(paths.length>100)throw new Error('Protect at most 100 different media files per note.');if(!paths.length)return {note:old,url,changed:false,protected:0};const ids=new Map();try{for(const path of paths){const result=await createNoteAttachment({path},signal);ids.set(path,result.attachment.id);}}catch(error){throw new Error(error.message+' Prepared media copies remain available for a safe retry.');}for(const item of legacy)parsed.lines[item.index]=NotesMedia.rewrite(item.line,ids.get(item.path));const note=await saveNoteMedia(old,parsed.lines.join('\n'),signal);return {note,url,changed:true,protected:legacy.length};}
export async function exportNoteBundle(args,signal){const out=await outputPath(args.output,['.roomnote']),response=await request('/api/notes/'+args.note_id+'/bundle?'+new URLSearchParams({revision:String(args.base_revision)}),{signal});return {...await saveResponse(response,out,'application/json',signal),note_id:args.note_id,revision:args.base_revision};}
export async function importNoteBundle(args,signal){const input=await inputPath(args.input),stat=await fs.stat(input);if(stat.size>36*1024*1024)throw new Error('Note bundles must be at most 36 MiB.');const response=await request('/api/notes/bundles/import?'+new URLSearchParams({import_id:args.import_id}),{method:'POST',signal,headers:{'Content-Type':'application/json','Content-Length':String(stat.size)},body:createReadStream(input)}),result=await response.json();return {...result,url:serverUrl()+'/notesroom/?'+new URLSearchParams({note:result.note.id})};}
export async function notesFolders(args,signal){return args.create?json('/api/notes/folders','POST',{path:args.create},signal):json('/api/notes/folders','GET',undefined,signal);}
export async function deleteNotesFolder(args,signal){return json('/api/notes/folders','DELETE',{path:args.path},signal);}

const pathPoint=p=>({x:p.x,y:p.y,inX:p.in_x??p.inX??p.x,inY:p.in_y??p.inY??p.y,outX:p.out_x??p.outX??p.x,outY:p.out_y??p.outY??p.y});
function object(entry){
  const preset=entry.type==='stroke'&&entry.brush_preset?PaintModel.brushPresets[entry.brush_preset]:null;
  const common={id:entry.id||crypto.randomUUID(),...(entry.name===undefined?{}:{name:entry.name}),opacity:entry.opacity??preset?.opacity??1,color:entry.color||'#765ee8',width:entry.width??preset?.width??8};
  if(entry.type==='stroke')return {type:'stroke',points:entry.points,...common,erase:entry.erase??false};
  if(entry.type==='path')return {type:'path',points:entry.points.map(pathPoint),closed:entry.closed??false,...common,fill:entry.fill||null,stroke:entry.stroke??(!entry.fill||entry.color!==undefined||entry.width!==undefined)};
  return {type:entry.type,x:entry.x,y:entry.y,x2:entry.x2,y2:entry.y2,...common,fill:entry.type==='line'?null:(entry.fill||null),...(entry.type==='line'?{}:{stroke:entry.stroke??(!entry.fill||entry.color!==undefined||entry.width!==undefined)})};
}
function objects(entries,state,layer){return entries.flatMap(entry=>{const item=object(entry);if(item.type!=='stroke'||!entry.symmetry||entry.symmetry==='none')return [item];return PaintModel.mirrorStrokePoints(item.points,state,layer,entry.symmetry).map((points,i)=>({...item,id:i?crypto.randomUUID():item.id,points}));});}
export async function paintBrushPresets(){return {presets:Object.entries(PaintModel.brushPresets).map(([id,preset])=>({id,...preset}))};}
async function sourceImage(sharedPath,state,signal){
  const response=await request(query('/api/workspace/file',{path:sharedPath}),{signal}), declared=Number(response.headers.get('content-length')||0);
  if(declared>20*1024*1024){await response.body?.cancel();throw new Error('PaintRoom images must be 20 MB or smaller.');}
  const data=Buffer.from(await response.arrayBuffer());if(data.length>20*1024*1024)throw new Error('PaintRoom images must be 20 MB or smaller.');
  const ext=path.extname(sharedPath).toLowerCase(),type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif'}[ext];
  if(!type)throw new Error('Use a PNG, JPEG, WebP, GIF, or AVIF image.');
  const url='data:'+type+';base64,'+data.toString('base64');
  const dimensions=await withRoom('/paintroom/','PaintRoom',signal,page=>page.evaluate(async src=>{const img=new Image();img.src=src;await img.decode();return {width:img.naturalWidth,height:img.naturalHeight};},url));
  const factor=Math.min(state.width/dimensions.width,state.height/dimensions.height,1),width=dimensions.width*factor,height=dimensions.height*factor;
  return {type:'image',id:crypto.randomUUID(),data:url,x:(state.width-width)/2,y:(state.height-height)/2,width,height,opacity:1};
}
async function readWorkspaceJson(file,maxBytes=16*1024*1024){const resolved=await inputPath(file),stat=await fs.stat(resolved);if(stat.size>maxBytes)throw new Error('JSON file exceeds the size limit.');const data=await fs.readFile(resolved);if(data.length>maxBytes)throw new Error('JSON file exceeds the size limit.');try{return JSON.parse(data.toString('utf8'));}catch{throw new Error('Workspace file must contain valid JSON.');}}
async function inputs(args){
  if(args.elements!==undefined&&args.elements_path!==undefined)throw new Error('Provide elements or elements_path, not both.');
  if(args.updates!==undefined&&args.updates_path!==undefined)throw new Error('Provide updates or updates_path, not both.');
  const elements=args.elements_path===undefined?(args.elements||[]):elementArray.parse(await readWorkspaceJson(args.elements_path));
  const updates=args.updates_path===undefined?(args.updates||[]):updateArray.parse(await readWorkspaceJson(args.updates_path));
  return {elements,updates};
}
const projectUrl=id=>serverUrl()+'/paintroom/?'+new URLSearchParams({project:id});
export async function paintCreate(args,signal){
  const {elements}=await inputs(args),id=args.project_id||crypto.randomUUID(),state=PaintModel.empty(()=>crypto.randomUUID(),args.name,args.width||1200,args.height||800);
  if(args.transparent)state.background=null;
  if(args.shared_image){state.layers[0].name='Image';state.layers[0].objects.push(await sourceImage(args.shared_image,state,signal));state.layers.push(PaintModel.layer(crypto.randomUUID(),'Drawing'));}
  const target=state.layers.at(-1);if(args.mask!==undefined)target.mask=args.mask;target.objects.push(...objects(elements,state,target));PaintModel.validate(state);
  const saved=await json('/api/paint/projects/'+id,'PUT',{baseRevision:0,state},signal),result={project_id:id,revision:saved.revision,name:state.name,url:projectUrl(id)};return optionalPaintPreview(result,saved,args,signal);
}
export async function paintImport(args,signal){
  const value=await readWorkspaceJson(args.project_path,32*1024*1024),state=value?.state??value,id=args.project_id||crypto.randomUUID();PaintModel.validate(state);PaintModel.ensureIds(state);if(args.name!==undefined)state.name=args.name;PaintModel.validate(state);
  const saved=await json('/api/paint/projects/'+id,'PUT',{baseRevision:0,state},signal);return optionalPaintPreview({project_id:id,revision:saved.revision,name:state.name,url:projectUrl(id)},saved,args,signal);
}
async function applyPaintChanges(state,args){
  const {elements,updates}=await inputs(args);PaintModel.validate(state);PaintModel.ensureIds(state);let target=state.layers.find(l=>l.id===args.layer_id);
  if(args.layer_id&&args.new_layer)throw new Error('Provide layer_id or new_layer, not both.');
  if(args.new_layer){target=PaintModel.layer(crypto.randomUUID(),args.new_layer);state.layers.push(target);}else if(!target)target=state.layers.at(-1);
  if(args.layer_id&&!state.layers.some(l=>l.id===args.layer_id))throw new Error('Layer not found.');
  if(args.name!==undefined)state.name=args.name;if(args.transform){const {pivot_x,pivot_y,...rest}=args.transform;Object.assign(target,rest);if(pivot_x!==undefined)target.pivotX=pivot_x;if(pivot_y!==undefined)target.pivotY=pivot_y;}if(args.mask!==undefined){if(args.mask===null)delete target.mask;else target.mask=args.mask;}
  const allowed={stroke:['name','points','color','width','opacity','erase'],rect:['name','x','y','x2','y2','width','color','fill','stroke','opacity'],ellipse:['name','x','y','x2','y2','width','color','fill','stroke','opacity'],line:['name','x','y','x2','y2','width','color','opacity'],path:['name','points','closed','color','fill','stroke','width','opacity'],image:['name','x','y','width','height','opacity']},changed=new Set(),removed=new Set();
  for(const update of updates){if((update.index===undefined)===(update.object_id===undefined))throw new Error('Each update needs exactly one index or object_id.');const index=update.index??target.objects.findIndex(item=>item.id===update.object_id),item=target.objects[index];if(!item||changed.has(index))throw new Error('Object update target is invalid or duplicated.');const {index:ignoredIndex,object_id:ignoredId,...values}=update,keys=Object.keys(values);if(!keys.length||keys.some(key=>!allowed[item.type]?.includes(key)))throw new Error('Unsupported fields for '+item.type+' at index '+index+'.');if(item.type==='path'&&values.points){if(values.points.some(p=>p.pressure!==undefined))throw new Error('Pressure applies only to brush strokes.');values.points=values.points.map(pathPoint);}Object.assign(item,values);changed.add(index);}
  const removalIndices=[...(args.remove_indices||[]),...(args.remove_ids||[]).map(id=>target.objects.findIndex(item=>item.id===id))];for(const index of removalIndices){if(!target.objects[index]||removed.has(index)||changed.has(index))throw new Error('Object removal target is invalid, duplicated or also updated: '+index);removed.add(index);}
  if(removed.size)target.objects=target.objects.filter((_,index)=>!removed.has(index));
  target.objects.push(...objects(elements,state,target));PaintModel.validate(state);return target;
}
export async function paintEdit(args,signal){
  const project=await json('/api/paint/projects/'+args.project_id,'GET',undefined,signal);if(project.revision!==args.base_revision)throw new Error('This PaintRoom project changed on another device.');
  const state=project.state,target=await applyPaintChanges(state,args);
  const saved=await json('/api/paint/projects/'+args.project_id,'PUT',{baseRevision:args.base_revision,state},signal),result={project_id:saved.id,revision:saved.revision,layer_id:target.id,name:state.name};return optionalPaintPreview(result,saved,args,signal);
}
export async function paintClone(args,signal){
  const project=await json('/api/paint/projects/'+args.source_project_id,'GET',undefined,signal);if(project.revision!==args.source_revision)throw new Error('The source PaintRoom project changed on another device.');const state=structuredClone(project.state),target=await applyPaintChanges(state,args),id=args.project_id||crypto.randomUUID();const saved=await json('/api/paint/projects/'+id,'PUT',{baseRevision:0,state},signal);
  return optionalPaintPreview({project_id:id,revision:saved.revision,layer_id:target.id,name:state.name,source_project_id:project.id,source_revision:project.revision,url:projectUrl(id)},saved,args,signal);
}
async function renderPaintProjects(projects,kind,maxDimension,columns,signal,crop,similarity){return withRoom('/paintroom/','PaintRoom',signal,page=>previewOnPage(page,{kind,projects,maxDimension,columns,crop,similarity}));}
async function optionalPaintPreview(result,project,args,signal){if(!args.include_preview)return result;try{return attachPreview(result,await renderPaintProjects([project],'paint',args.preview_max_dimension,undefined,signal));}catch(error){return {...result,preview_error:'The project was saved, but preview failed: '+error.message};}}
export async function paintPreview(args,signal){const project=await json('/api/paint/projects/'+args.project_id,'GET',undefined,signal);return attachPreview({project_id:project.id,revision:project.revision,name:project.state.name},await renderPaintProjects([project],'paint',args.max_dimension,undefined,signal,args.crop));}
export async function paintPreviewSheet(args,signal){const projects=[];let bytes=0;for(const id of args.project_ids){const project=await json('/api/paint/projects/'+id,'GET',undefined,signal);bytes+=Buffer.byteLength(JSON.stringify(project));if(bytes>48*1024*1024)throw new Error('Projects are too large to preview together; use smaller batches.');projects.push(project);}const rendered=await renderPaintProjects(projects,'sheet',args.max_dimension||1536,args.columns,signal,undefined,args.similarity),{similarity,...preview}=rendered;return attachPreview({projects:projects.map(p=>({project_id:p.id,revision:p.revision,name:p.state.name})),...(similarity?{similarity:{metric:'1 - mean absolute RGB difference on 64x64 thumbnails composited over white',matrix:similarity}}:{})},preview);}
export async function previewImage(args,signal){const file=await inputPath(args.input),extension=path.extname(file).toLowerCase();if(!['.png','.jpg','.jpeg','.webp','.gif','.avif'].includes(extension))throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF image.');const stat=await fs.stat(file);if(stat.size>20*1024*1024)throw new Error('Images must be 20 MB or smaller to preview.');
  return withRoom('/paintroom/','PaintRoom',signal,async page=>{await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='roomsuitePreviewFile';document.body.append(input);});await page.locator('#roomsuitePreviewFile').setInputFiles(file);return attachPreview({name:path.basename(file)},await previewOnPage(page,{kind:'file',maxDimension:args.max_dimension}));});}
export async function paintGet(args,signal){const project=await json('/api/paint/projects/'+args.project_id,'GET',undefined,signal);PaintModel.validate(project.state);PaintModel.ensureIds(project.state);return {project};}
export async function paintList(args,signal){return json('/api/paint/projects','GET',undefined,signal);}
export async function paintExport(args,signal){
  const project=await json('/api/paint/projects/'+args.project_id,'GET',undefined,signal),ext='.'+args.format,out=await outputPath(args.output,[ext]);PaintModel.validate(project.state);
  if(args.format!=='png'){
    const data=args.format==='svg'?PaintModel.svg(project.state):JSON.stringify(args.format==='vectorroom'?PaintModel.toVector(project.state):project.state);
    try{await fs.writeFile(out,data,{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')throw new Error('Output already exists: '+args.output);throw error;}
    return {path:out,bytes:Buffer.byteLength(data),mime_type:args.format==='svg'?'image/svg+xml':'application/json',room:'PaintRoom',operation:'export'};
  }
  return withRoom('/paintroom/','PaintRoom',signal,async page=>{
    const pending=page.waitForEvent('download',{timeout:60000});
    await page.evaluate(async state=>{setProject(state,uid(),0);download(await png(),'artwork.png');},project.state);
    const result=await saveDownload(await pending,out,'image/png');return {...result,room:'PaintRoom',operation:'export'};
  });
}

// The manifest records the exact saved revisions used, even when multiple
// projects produce byte-identical PNGs and share one output file.
export async function paintExportBatch(args,signal){
  const prefix=args.prefix||'frame',directory=args.directory||'.',projects=[],outputs=[];let projectBytes=0;
  const manifestPath=await outputPath(path.join(directory,prefix+'-manifest.json'),['.json']);
  for(let i=0;i<args.project_ids.length;i++){
    const project=await json('/api/paint/projects/'+args.project_ids[i],'GET',undefined,signal);PaintModel.validate(project.state);projectBytes+=Buffer.byteLength(JSON.stringify(project));if(projectBytes>48*1024*1024)throw new Error('Projects are too large to export together; use smaller batches.');projects.push(project);outputs.push(await outputPath(path.join(directory,prefix+'-'+String(i+1).padStart(4,'0')+'.png'),['.png']));
  }
  const frames=[],hashes=new Map();let error=null;
  try{await withRoom('/paintroom/','PaintRoom',signal,async page=>{
    for(let i=0;i<projects.length;i++){
      const project=projects[i],pending=page.waitForEvent('download',{timeout:60000});await page.evaluate(async state=>{setProject(state,uid(),0);download(await png(),'frame.png');},project.state);const download=await pending,failure=await download.failure();if(failure)throw new Error('Frame download failed: '+failure);const temp=await download.path(),data=await fs.readFile(temp);if(!data.length)throw new Error('The editor produced an empty frame.');const sha256=crypto.createHash('sha256').update(data).digest('hex');let destination=hashes.get(sha256),reused=!!destination;
      if(!destination){destination=outputs[i];await fs.writeFile(destination,data,{flag:'wx',mode:0o600});hashes.set(sha256,destination);}
      frames.push({project_id:project.id,revision:project.revision,name:project.state.name,width:project.state.width,height:project.state.height,path:destination,bytes:data.length,sha256,reused});
    }
  });}catch(cause){error=cause.message;}
  const manifest={format:'roomsuite-frame-manifest',version:1,created_at:new Date().toISOString(),fps:args.fps??null,complete:!error,frames,...(error?{error}:{})};let manifestError;
  try{await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});}catch(cause){manifestError='Frames were exported, but the manifest could not be written: '+cause.message;}
  return {...manifest,...(!manifestError?{manifest_path:manifestPath}:{manifest_error:manifestError})};
}
