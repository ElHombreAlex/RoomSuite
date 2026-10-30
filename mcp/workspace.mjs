import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inputPath, outputPath, saveResponse, saveDownload } from './files.mjs';
import { serverUrl, withRoom } from './rooms.mjs';
import PaintModel from '../PaintRoom/model.js';
import { attachPreview, previewOnPage } from './preview.mjs';

async function request(route, { method='GET', body, signal, headers={} } = {}) {
  const origin=serverUrl(), response=await fetch(origin+route,{method,signal,headers:{...(method==='GET'?{}:{Origin:origin,'X-Cliproom-Request':'1'}),...headers},...(body===undefined?{}:{body}),...(body && typeof body.pipe==='function'?{duplex:'half'}:{})});
  if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error || 'RoomSuite request failed ('+response.status+').');}
  return response;
}
async function json(route,method='GET',data,signal){return (await request(route,{method,signal,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})})).json();}
const query=(route,values)=>route+'?'+new URLSearchParams(values);
export async function listShared(args,signal){return json(query('/api/workspace/list',{path:args.path||''}),'GET',undefined,signal);}
export async function searchShared(args,signal){return json(query('/api/workspace/search',{q:args.query}),'GET',undefined,signal);}
export async function uploadShared(args,signal){const file=await inputPath(args.input),stat=await fs.stat(file);return (await request(query('/api/workspace/upload',{path:args.path}),{method:'POST',body:createReadStream(file),signal,headers:{'Content-Length':String(stat.size),'Content-Type':'application/octet-stream'}})).json();}
export async function downloadShared(args,signal){const ext=path.extname(args.output).toLowerCase(),out=await outputPath(args.output,[ext]),response=await request(query('/api/workspace/file',{path:args.path}),{signal});return saveResponse(response,out,'application/octet-stream',signal,{allowEmpty:true});}
export async function folderShared(args,signal){return json('/api/workspace/folder','POST',{path:args.path},signal);}
export async function moveShared(args,signal){return json('/api/workspace/move','POST',{from:args.from,to:args.to},signal);}
export async function deleteShared(args,signal){return json('/api/workspace/delete','POST',{path:args.path,recursive:args.recursive===true},signal);}
export async function listNotes(args,signal){const q={};if(args.search)q.search=args.search;if(args.folder!==undefined)q.folder=args.folder;if(args.tag)q.tag=args.tag;return json(query('/api/notes',q),'GET',undefined,signal);}
export async function getNote(args,signal){return {note:await json('/api/notes/'+args.note_id,'GET',undefined,signal),url:serverUrl()+'/notesroom/?'+new URLSearchParams({note:args.note_id})};}
export async function createNote(args,signal){const note=await json('/api/notes','POST',{title:args.title,body:args.body||'',folder:args.folder||'',tags:args.tags||[]},signal);return {note,url:serverUrl()+'/notesroom/?'+new URLSearchParams({note:note.id})};}
export async function updateNote(args,signal){const old=await json('/api/notes/'+args.note_id,'GET',undefined,signal);const note=await json('/api/notes/'+args.note_id,'PUT',{baseRevision:args.base_revision,title:args.title??old.title,body:args.body??old.body,folder:args.folder??old.folder,tags:args.tags??old.tags},signal);return {note,url:serverUrl()+'/notesroom/?'+new URLSearchParams({note:note.id})};}
export async function deleteNote(args,signal){return json('/api/notes/'+args.note_id,'DELETE',{baseRevision:args.base_revision},signal);}
export async function notesFolders(args,signal){return args.create?json('/api/notes/folders','POST',{path:args.create},signal):json('/api/notes/folders','GET',undefined,signal);}
export async function deleteNotesFolder(args,signal){return json('/api/notes/folders','DELETE',{path:args.path},signal);}

function object(entry){
  const common={opacity:entry.opacity??1,color:entry.color||'#765ee8',width:entry.width??8};
  if(entry.type==='stroke')return {type:'stroke',points:entry.points,...common,erase:entry.erase??false};
  return {type:entry.type,x:entry.x,y:entry.y,x2:entry.x2,y2:entry.y2,...common,fill:entry.type==='line'?null:(entry.fill||null),...(entry.type==='line'?{}:{stroke:entry.stroke??(!entry.fill||entry.color!==undefined||entry.width!==undefined)})};
}
async function sourceImage(sharedPath,state,signal){
  const response=await request(query('/api/workspace/file',{path:sharedPath}),{signal}), declared=Number(response.headers.get('content-length')||0);
  if(declared>20*1024*1024){await response.body?.cancel();throw new Error('PaintRoom images must be 20 MB or smaller.');}
  const data=Buffer.from(await response.arrayBuffer());if(data.length>20*1024*1024)throw new Error('PaintRoom images must be 20 MB or smaller.');
  const ext=path.extname(sharedPath).toLowerCase(),type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif'}[ext];
  if(!type)throw new Error('Use a PNG, JPEG, WebP, GIF, or AVIF image.');
  const url='data:'+type+';base64,'+data.toString('base64');
  const dimensions=await withRoom('/paintroom/','PaintRoom',signal,page=>page.evaluate(async src=>{const img=new Image();img.src=src;await img.decode();return {width:img.naturalWidth,height:img.naturalHeight};},url));
  const factor=Math.min(state.width/dimensions.width,state.height/dimensions.height,1),width=dimensions.width*factor,height=dimensions.height*factor;
  return {type:'image',data:url,x:(state.width-width)/2,y:(state.height-height)/2,width,height,opacity:1};
}
export async function paintCreate(args,signal){
  const id=crypto.randomUUID(),state=PaintModel.empty(()=>crypto.randomUUID(),args.name,args.width||1200,args.height||800);
  if(args.transparent)state.background=null;
  if(args.shared_image){state.layers[0].name='Image';state.layers[0].objects.push(await sourceImage(args.shared_image,state,signal));state.layers.push(PaintModel.layer(crypto.randomUUID(),'Drawing'));}
  state.layers.at(-1).objects.push(...(args.elements||[]).map(object));PaintModel.validate(state);
  const saved=await json('/api/paint/projects/'+id,'PUT',{baseRevision:0,state},signal),result={project_id:id,revision:saved.revision,name:state.name,url:serverUrl()+'/paintroom/?'+new URLSearchParams({project:id})};return optionalPaintPreview(result,saved,args,signal);
}
export async function paintEdit(args,signal){
  const project=await json('/api/paint/projects/'+args.project_id,'GET',undefined,signal);if(project.revision!==args.base_revision)throw new Error('This PaintRoom project changed on another device.');
  const state=project.state;let target=state.layers.find(l=>l.id===args.layer_id);
  if(args.new_layer){target=PaintModel.layer(crypto.randomUUID(),args.new_layer);state.layers.push(target);}else if(!target)target=state.layers.at(-1);
  if(args.layer_id&&!state.layers.some(l=>l.id===args.layer_id))throw new Error('Layer not found.');
  if(args.name!==undefined)state.name=args.name;if(args.transform)Object.assign(target,args.transform);
  const allowed={stroke:['points','color','width','opacity','erase'],rect:['x','y','x2','y2','width','color','fill','stroke','opacity'],ellipse:['x','y','x2','y2','width','color','fill','stroke','opacity'],line:['x','y','x2','y2','width','color','opacity'],image:['x','y','width','height','opacity']},changed=new Set(),removed=new Set();
  for(const update of args.updates||[]){const {index,...values}=update,item=target.objects[index];if(!item||changed.has(index))throw new Error('Object update index is invalid or duplicated: '+index);const keys=Object.keys(values);if(!keys.length||keys.some(key=>!allowed[item.type]?.includes(key)))throw new Error('Unsupported fields for '+item.type+' at index '+index+'.');Object.assign(item,values);changed.add(index);}
  for(const index of args.remove_indices||[]){if(!target.objects[index]||removed.has(index)||changed.has(index))throw new Error('Object removal index is invalid, duplicated or also updated: '+index);removed.add(index);}
  if(removed.size)target.objects=target.objects.filter((_,index)=>!removed.has(index));
  target.objects.push(...(args.elements||[]).map(object));PaintModel.validate(state);
  const saved=await json('/api/paint/projects/'+args.project_id,'PUT',{baseRevision:args.base_revision,state},signal),result={project_id:saved.id,revision:saved.revision,layer_id:target.id,name:state.name};return optionalPaintPreview(result,saved,args,signal);
}
async function renderPaintProjects(projects,kind,maxDimension,columns,signal){return withRoom('/paintroom/','PaintRoom',signal,page=>previewOnPage(page,{kind,projects,maxDimension,columns}));}
async function optionalPaintPreview(result,project,args,signal){if(!args.include_preview)return result;try{return attachPreview(result,await renderPaintProjects([project],'paint',args.preview_max_dimension,undefined,signal));}catch(error){return {...result,preview_error:'The project was saved, but preview failed: '+error.message};}}
export async function paintPreview(args,signal){const project=await json('/api/paint/projects/'+args.project_id,'GET',undefined,signal);return attachPreview({project_id:project.id,revision:project.revision,name:project.state.name},await renderPaintProjects([project],'paint',args.max_dimension,undefined,signal));}
export async function paintPreviewSheet(args,signal){const projects=[];let bytes=0;for(const id of args.project_ids){const project=await json('/api/paint/projects/'+id,'GET',undefined,signal);bytes+=Buffer.byteLength(JSON.stringify(project));if(bytes>48*1024*1024)throw new Error('Projects are too large to preview together; use smaller batches.');projects.push(project);}const preview=await renderPaintProjects(projects,'sheet',args.max_dimension||1536,args.columns,signal);return attachPreview({projects:projects.map(p=>({project_id:p.id,revision:p.revision,name:p.state.name}))},preview);}
export async function previewImage(args,signal){const file=await inputPath(args.input),extension=path.extname(file).toLowerCase();if(!['.png','.jpg','.jpeg','.webp','.gif','.avif'].includes(extension))throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF image.');const stat=await fs.stat(file);if(stat.size>20*1024*1024)throw new Error('Images must be 20 MB or smaller to preview.');
  return withRoom('/paintroom/','PaintRoom',signal,async page=>{await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='roomsuitePreviewFile';document.body.append(input);});await page.locator('#roomsuitePreviewFile').setInputFiles(file);return attachPreview({name:path.basename(file)},await previewOnPage(page,{kind:'file',maxDimension:args.max_dimension}));});}
export async function paintGet(args,signal){return {project:await json('/api/paint/projects/'+args.project_id,'GET',undefined,signal)};}
export async function paintList(args,signal){return json('/api/paint/projects','GET',undefined,signal);}
export async function paintExport(args,signal){
  const project=await json('/api/paint/projects/'+args.project_id,'GET',undefined,signal),ext='.'+args.format,out=await outputPath(args.output,[ext]);PaintModel.validate(project.state);
  if(args.format!=='png'){
    const data=args.format==='svg'?PaintModel.svg(project.state):JSON.stringify(project.state);
    try{await fs.writeFile(out,data,{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')throw new Error('Output already exists: '+args.output);throw error;}
    return {path:out,bytes:Buffer.byteLength(data),mime_type:args.format==='svg'?'image/svg+xml':'application/json',room:'PaintRoom',operation:'export'};
  }
  return withRoom('/paintroom/','PaintRoom',signal,async page=>{
    const pending=page.waitForEvent('download',{timeout:60000});
    await page.evaluate(async state=>{setProject(state,uid(),0);download(await png(),'artwork.png');},project.state);
    const result=await saveDownload(await pending,out,'image/png');return {...result,room:'PaintRoom',operation:'export'};
  });
}
