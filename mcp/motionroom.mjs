import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {inputPath,outputPath,saveDownload} from './files.mjs';
import {withRoom,serverUrl} from './rooms.mjs';
import {attachPreview} from './preview.mjs';
const require=createRequire(import.meta.url),Motion=require('../MotionRoom/model.js'),MAX=40*1024*1024;

async function readJson(input,max=MAX){const file=await inputPath(input),stat=await fs.stat(file);if(stat.size>max)throw new Error('The input file is too large.');const bytes=await fs.readFile(file);if(bytes.length>max)throw new Error('The input file is too large.');let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('The input must be UTF-8 JSON.');}return {file,bytes,value,revision:crypto.createHash('sha256').update(bytes).digest('hex')};}
async function readProject(input){const result=await readJson(input);return {...result,project:Motion.validate(result.value)};}
async function saveProject(project,output){const validated=Motion.validate(project),bytes=Buffer.from(JSON.stringify(validated));if(bytes.length>MAX)throw new Error('MotionRoom projects must be 40 MiB or smaller.');const target=await outputPath(output,['.motionroom']);try{await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')throw new Error('Output already exists: '+output);throw error;}return {path:target,bytes:bytes.length,revision:crypto.createHash('sha256').update(bytes).digest('hex'),room:'MotionRoom',mime_type:'application/json'};}
async function embedded(spec,kind){
  if(!spec||typeof spec!=='object'||typeof spec.path!=='string')throw new Error('A resource path is required.');const file=await inputPath(spec.path),ext=path.extname(file).toLowerCase(),types=kind==='font'?{'.woff':'woff','.woff2':'woff2','.ttf':'ttf','.otf':'otf'}:{'.png':'png','.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp','.gif':'gif','.avif':'avif'},type=types[ext],limit=(kind==='font'?10:20)*1024*1024;
  if(!type)throw new Error(kind==='font'?'Use a WOFF, WOFF2, TTF or OTF font.':'Use a PNG, JPEG, WebP, GIF or AVIF image.');const stat=await fs.stat(file);if(stat.size>limit)throw new Error('Resource is too large.');const bytes=await fs.readFile(file);if(bytes.length>limit)throw new Error('Resource is too large.');
  const magic=bytes.subarray(0,4).toString('latin1'),valid=kind==='font'?({woff:magic==='wOFF',woff2:magic==='wOF2',ttf:magic==='\x00\x01\x00\x00'||magic==='true',otf:magic==='OTTO'})[type]:({png:bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg:bytes[0]===255&&bytes[1]===216,gif:magic==='GIF8',webp:magic==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP',avif:bytes.subarray(4,8).toString()==='ftyp'&&/avif|avis/.test(bytes.subarray(8,40).toString('latin1'))})[type];if(!valid)throw new Error('The resource contents do not match the file type.');
  const id=spec.id||crypto.randomUUID(),data=`data:${kind==='font'?'font':'image'}/${type};base64,${bytes.toString('base64')}`;
  return kind==='font'?{id,name:spec.name||path.basename(file,path.extname(file)),data}:{id,data};
}
function framesFor(layer,frames,fps){
  if(!Array.isArray(frames))throw new Error('Keyframes must be an array.');let values={...Motion.defaults,...(layer.kind==='text'?{reveal:1}:{}),...(layer.kind==='lens'?{zoom:layer.lens.zoom}:{})},last=-1,easing='linear';
  return frames.map(frame=>{if(!frame||typeof frame!=='object'||(frame.time===undefined)===(frame.frame===undefined))throw new Error('Each keyframe needs exactly one of time or frame.');if(frame.frame!==undefined&&(!Number.isInteger(frame.frame)||frame.frame<0))throw new Error('Frame numbers must be nonnegative integers.');const time=frame.frame===undefined?frame.time:frame.frame/fps;if(typeof time!=='number'||!Number.isFinite(time)||time<=last)throw new Error('Keyframes must be in strictly increasing time order.');last=time;
    const allowed=new Set(['time','frame','x','y','scale','rotation','opacity','reveal','zoom','easing']);for(const key of Object.keys(frame))if(!allowed.has(key))throw new Error('Unknown keyframe field: '+key);if(frame.reveal!==undefined&&layer.kind!=='text'||frame.zoom!==undefined&&layer.kind!=='lens')throw new Error('Reveal applies to text and zoom applies to lens layers.');
    for(const key of Object.keys(values))if(frame[key]!==undefined)values[key]=frame[key];if(frame.easing!==undefined)easing=frame.easing;return {time,...values,easing};});
}
function makeLayer(raw,project){
  if(!raw||typeof raw!=='object'||!['text','shape','image','lens'].includes(raw.kind))throw new Error('A new layer must be text, shape, image or lens.');
  const allowed=new Set(['id','kind','name','visible','keyframes',raw.kind]);for(const key of Object.keys(raw))if(!allowed.has(key))throw new Error('Unsupported layer field: '+key);
  const id=raw.id||crypto.randomUUID(),name=raw.name||({text:'Text',shape:'Shape',image:'Image',lens:'Magnifier'})[raw.kind],layer={id,kind:raw.kind,name,visible:raw.visible??true,keyframes:[]};
  if(raw.kind==='text')layer.text={content:'Your text',x:project.width/2,y:project.height/2,fontSize:72,font:'sans-serif',weight:'normal',style:'normal',align:'center',lineHeight:1.2,color:'#222222',...raw.text};
  if(raw.kind==='shape')layer.shape={type:'rect',x:0,y:0,width:200,height:100,fill:'#a895e9',stroke:'#302a3e',strokeWidth:0,radius:0,...raw.shape};
  if(raw.kind==='image')layer.image={x:0,y:0,width:project.width,height:project.height,...raw.image};
  if(raw.kind==='lens')layer.lens={x:project.width/2,y:project.height/2,radius:100,zoom:2,offsetX:0,offsetY:0,stroke:'#93a61b',strokeWidth:10,...raw.lens};
  layer.keyframes=framesFor(layer,raw.keyframes||[],project.fps);return layer;
}
async function loadArray(inline,file,label){if(inline!==undefined&&file!==undefined)throw new Error('Provide '+label+' or its file, not both.');const value=file?(await readJson(file,32*1024*1024)).value:(inline||[]);if(!Array.isArray(value))throw new Error(label+' must be an array.');return value;}
function setStage(project,stage){if(!stage||typeof stage!=='object')throw new Error('Stage settings are required.');const allowed=['name','width','height','duration','background','fps','holdFrames'];for(const key of Object.keys(stage)){if(!allowed.includes(key))throw new Error('Unsupported stage setting: '+key);project[key]=stage[key];}}

export async function createMotion(args){
  const project=args.source_path?Motion.create((await readJson(args.source_path)).value):Motion.empty();setStage(project,args.stage||{});
  for(const font of args.fonts||[])project.fonts.push(await embedded(font,'font'));for(const asset of args.assets||[])project.assets.push(await embedded(asset,'image'));
  for(const layer of await loadArray(args.layers,args.layers_path,'layers'))project.layers.push(makeLayer(layer,project));
  return {...await saveProject(project,args.output),operation:'create_motion',width:project.width,height:project.height,layers:project.layers.length,fps:project.fps};
}
export async function inspectMotion({input,include_keyframes=false}){const {project,revision}=await readProject(input);return {revision,name:project.name,width:project.width,height:project.height,duration:project.duration,background:project.background,fps:project.fps,holdFrames:project.holdFrames,sourceType:project.sourceType,fonts:project.fonts.map(({id,name})=>({id,name})),assets:project.assets.map(({id})=>({id})),layers:project.layers.map(({id,kind,name,visible,keyframes,sourceIndex,text,shape,image,lens})=>({id,kind,name,visible,keyframe_count:keyframes.length,...(include_keyframes?{keyframes}:{}),...(sourceIndex===undefined?{}:{sourceIndex}),...(text?{text}:{}),...(shape?{shape}:{}),...(image?{image}:{}),...(lens?{lens}:{})}))};}
export async function editMotion(args){
  const {project,revision}=await readProject(args.input);if(args.revision!==revision)throw Object.assign(new Error('This motion project changed. Inspect it again before editing.'),{code:'REVISION_CONFLICT',currentRevision:revision});
  const operations=await loadArray(args.operations,args.operations_path,'operations');if(operations.length>2000)throw new Error('At most 2,000 operations are supported.');
  for(const op of operations){
    if(!op||typeof op!=='object')throw new Error('Invalid motion operation.');
    if(op.op==='set_stage')setStage(project,op.stage);
    else if(op.op==='import_source')Motion.attachSource(project,(await readJson(op.source_path)).value,op.index??0);
    else if(op.op==='add_font')project.fonts.push(await embedded(op.font,'font'));
    else if(op.op==='add_asset')project.assets.push(await embedded(op.asset,'image'));
    else if(op.op==='add_layer')project.layers.push(makeLayer(op.layer,project));
    else {const index=project.layers.findIndex(layer=>layer.id===op.layer_id);if(index<0)throw new Error('Motion layer not found: '+op.layer_id);const layer=project.layers[index];
      if(op.op==='set_keyframes')layer.keyframes=framesFor(layer,op.keyframes,project.fps);
      else if(op.op==='remove_layer')project.layers.splice(index,1);
      else if(op.op==='move_layer'){if(!Number.isInteger(op.index)||op.index<0||op.index>=project.layers.length)throw new Error('Invalid layer destination index.');project.layers.splice(index,1);project.layers.splice(op.index,0,layer);}
      else if(op.op==='update_layer'){const changes=op.changes;if(!changes||typeof changes!=='object')throw new Error('Layer changes are required.');for(const key of Object.keys(changes)){if(['name','visible'].includes(key))layer[key]=changes[key];else if(key===layer.kind&&['text','shape','image','lens'].includes(key)&&changes[key]&&typeof changes[key]==='object')layer[key]={...layer[key],...changes[key]};else throw new Error('Unsupported layer change: '+key);}}
      else throw new Error('Unknown motion operation: '+op.op);
    }
  }
  return {...await saveProject(project,args.output),operation:'edit_motion',input_revision:revision,layers:project.layers.length};
}
async function browserProject(page,input){await page.locator('#projectFile').setInputFiles(input);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Artwork ready')||document.querySelector('#status').classList.contains('error'));if(await page.locator('#status').evaluate(node=>node.classList.contains('error')))throw new Error(await page.locator('#status').textContent());}
export async function previewMotion(args,signal){
  const {file,project}=await readProject(args.input);if(args.time<0||args.time>project.duration)throw new Error('Preview time must be within the composition.');
  return withRoom('/motionroom/','MotionRoom',signal,async page=>{await browserProject(page,file);const preview=await page.evaluate(({at,max})=>{const source=document.createElement('canvas');MotionRenderer.draw(source,project,prepared,at);const scale=Math.min(1,max/Math.max(source.width,source.height));let result=document.createElement('canvas');result.width=Math.max(1,Math.round(source.width*scale));result.height=Math.max(1,Math.round(source.height*scale));result.getContext('2d').drawImage(source,0,0,result.width,result.height);let data=result.toDataURL('image/png').split(',')[1];while(data.length>1400000&&Math.max(result.width,result.height)>256){const smaller=document.createElement('canvas');smaller.width=Math.max(1,Math.round(result.width*.8));smaller.height=Math.max(1,Math.round(result.height*.8));smaller.getContext('2d').drawImage(result,0,0,smaller.width,smaller.height);result=smaller;data=result.toDataURL('image/png').split(',')[1];}return {data,width:result.width,height:result.height,bytes:Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0),mime_type:'image/png'};},{at:args.time,max:args.max_dimension||1024});return attachPreview({room:'MotionRoom',operation:'preview_motion',time:args.time},preview);});
}
export async function renderMotion(args,signal){
  const {file,project}=await readProject(args.input),format=path.extname(args.output).toLowerCase()==='.mp4'?'mp4':'webm',target=await outputPath(args.output,['.mp4','.webm']);if(args.transparent&&format!=='webm')throw new Error('Transparent video requires WebM/VP9.');
  return withRoom('/motionroom/','MotionRoom',signal,async page=>{await browserProject(page,file);const download=page.waitForEvent('download',{timeout:600000});download.catch(()=>{});const metadata=await page.evaluate(async options=>{
    const {renderMotion}=await import('/motionroom/export.js'),out=await renderMotion({canvas,project,prepared,format:options.format,transparent:options.transparent,fps:options.fps,holdFrames:options.holdFrames});let asset=null;
    if(options.send){const response=await fetch('/api/assets',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Cliproom-Request':'1','X-File-Type':out.blob.type,'X-File-Name':encodeURIComponent('motionroom.'+options.format)},body:out.blob});const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value.error||'Could not send video to Cliproom.');asset=value.id;}
    const url=URL.createObjectURL(out.blob),a=document.createElement('a');a.href=url;a.download='motionroom.'+options.format;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);return {frames:out.frames,fps:out.fps,holdFrames:out.holdFrames,transparent:out.transparent,asset};
  },{format,transparent:!!args.transparent,fps:args.fps||project.fps,holdFrames:args.hold_frames||project.holdFrames,send:!!args.send_to_cliproom});let saved;try{saved=await saveDownload(await download,target,format==='mp4'?'video/mp4':'video/webm');}catch(error){if(metadata.asset)throw new Error(error.message+' The uploaded Cliproom asset '+metadata.asset+' remains on the server.');throw error;}return {...saved,room:'MotionRoom',operation:'render_motion',duration:project.duration,...metadata,...(metadata.asset?{cliproom_url:serverUrl()+'/cliproom/?'+new URLSearchParams({asset:metadata.asset,duration:String(project.duration)})}:{})};});
}
