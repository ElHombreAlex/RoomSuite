import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import PixelLayerMask from '../PixelRoom/dist/layer-mask.js';
import Grade from '../cliproom/public/color-grade.js';
import Timeline from '../cliproom/public/timeline.js';
import { inputPath, outputPath } from './files.mjs';
import { serverUrl, withRoom } from './rooms.mjs';
import { attachPreview,previewOnPage } from './preview.mjs';

async function readPreset(requested) {
  if (path.extname(requested).toLowerCase() !== '.roomgrade') throw new Error('A preset must use the .roomgrade extension.');
  const file = await inputPath(requested), stat = await fs.stat(file);
  if (stat.size > Grade.maxBytes) throw new Error('Preset files must be 2 MiB or smaller.');
  return Grade.parse(await fs.readFile(file, 'utf8'));
}
async function readCube(requested){
  if(path.extname(requested).toLowerCase()!=='.cube')throw new Error('A LUT must use the .cube extension.');
  const file=await inputPath(requested),stat=await fs.stat(file);if(stat.size>Grade.Look.maxCubeBytes)throw new Error('.cube files must be 2 MiB or smaller.');
  return Grade.Look.parseCube(await fs.readFile(file,'utf8'));
}
export async function inspectLut(args){const lut=await readCube(args.path);return {title:lut.title,size:lut.size,domain_min:lut.domain_min,domain_max:lut.domain_max,entries:lut.size**3,sha256:crypto.createHash('sha256').update(JSON.stringify(lut.data)).digest('hex')};}
export async function requestedGrade(args) {
  if (args.preset_path && (args.color_adjustments||args.color_look)) throw new Error('A preset cannot be combined with inline color adjustments or a creative look.');
  if(args.lut_path&&args.remove_lut)throw new Error('Choose a LUT file or remove_lut, not both.');
  const preset=args.preset_path?await readPreset(args.preset_path):null;
  const adjustments=preset?.adjustments||(args.color_adjustments?Grade.adjustments(args.color_adjustments):null);
  const look=preset?Grade.Look.validate(preset.look):(args.color_look?Grade.Look.validate(args.color_look):null);
  const lut=args.lut_path?await readCube(args.lut_path):args.remove_lut?null:undefined;
  return preset||adjustments||look||lut!==undefined?{adjustments,look,lut,fromPreset:!!preset}:null;
}
export function requestedLook(existing,request){let look=request?.look||existing.look;if(request&&request.lut!==undefined)look=Grade.Look.validate({...look,lut:request.lut});return look;}
export async function listPresets() {
  return { built_in:Grade.builtins, note:'Browser-saved presets are local to that browser. Use roomsuite_shared_list and roomsuite_shared_download to exchange .roomgrade files through Shared files.' };
}
export async function getPreset(args) { return { preset:await readPreset(args.path) }; }
export async function createPreset(args) {
  const look=Grade.Look.validate(args.look),lut=args.lut_path?await readCube(args.lut_path):undefined;
  const item = Grade.makePreset(args.name, args.adjustments || {}, args.description || '', args.tags || [],lut===undefined?look:{...look,lut});
  const data = Grade.serializePreset(item), output = await outputPath(args.output, ['.roomgrade']);
  await fs.writeFile(output, data, { flag:'wx', mode:0o600 });
  return { path:output, bytes:Buffer.byteLength(data), preset:item };
}
const lutSummaries=new WeakMap();
function summary(grade){if(!grade.look.lut)return grade;let lut=lutSummaries.get(grade.look.lut);if(!lut){const {data,...metadata}=grade.look.lut;lut={...metadata,entries:data.length/3,embedded:true,sha256:crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')};lutSummaries.set(grade.look.lut,lut);}return {...grade,look:{...grade.look,lut}};}
export async function applyClipGrade(args, signal) {
  const resolved = await requestedGrade(args), origin = serverUrl();
  const response = await fetch(origin + '/api/projects/' + encodeURIComponent(args.project_id), { signal });
  const project = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(project.error || 'Could not read the Cliproom project.');
  if (project.revision !== args.base_revision) throw Object.assign(new Error('This project changed on another device. Read it again before applying the grade.'), {status:409});
  if (!Array.isArray(project.state?.clips)) throw new Error('The project has no valid clip list.');
  const ids = [...new Set(args.clip_ids)];
  if (ids.length !== args.clip_ids.length) throw new Error('Clip IDs must be unique.');
  const clips = ids.map(id => project.state.clips.find(clip => clip.id === id));
  if (clips.some(clip => !clip)) throw new Error('At least one requested clip was not found; no changes were saved.');
  const changes = [], warnings = [];
  let projectedBytes=Buffer.byteLength(JSON.stringify({baseRevision:args.base_revision,state:project.state}));
  for (const clip of clips) {
    const previousBytes=Buffer.byteLength(JSON.stringify(clip));
    const before = Grade.readTarget(clip, 'clip');
    Grade.writeTarget(clip, 'clip', resolved?.adjustments||before.adjustments, args.strength ?? before.strength, args.enabled ?? (resolved ? true : before.enabled),requestedLook(before,resolved));
    projectedBytes+=Buffer.byteLength(JSON.stringify(clip))-previousBytes;
    const after = Grade.readTarget(clip, 'clip');
    changes.push({ clip_id:clip.id, before:summary(before), after:summary(after) });
    if (clip.keyframes?.some(frame => frame.creativeLook!==undefined||[...Grade.basic,...Grade.advanced,...Object.keys(Grade.Look.effectSpecs)].some(key => frame[key] !== undefined))) warnings.push('Clip ' + clip.id + ' has color keyframes; animated properties override their base values.');
  }
  const versionChanged = [1,2,3,4].includes(project.state.version);
  if(versionChanged)project.state=Timeline.migrate(project.state,()=>crypto.randomUUID());
  const changed = versionChanged || changes.some(change => JSON.stringify(change.before) !== JSON.stringify(change.after));
  if(projectedBytes>2*1024*1024)throw Object.assign(new Error('The project would exceed 2 MiB. Apply the LUT to fewer clips or use a smaller LUT.'),{status:413});
  if (args.dry_run || !changed) return { project_id:args.project_id, revision:project.revision, dry_run:!!args.dry_run, changed, changes, warnings };
  const savedResponse = await fetch(origin + '/api/projects/' + encodeURIComponent(args.project_id), {
    method:'PUT', signal, headers:{ 'Content-Type':'application/json', 'Origin':origin, 'X-Cliproom-Request':'1' },
    body:JSON.stringify({baseRevision:args.base_revision,state:project.state})
  });
  const saved = await savedResponse.json().catch(() => ({}));
  if (!savedResponse.ok) throw Object.assign(new Error(saved.error || 'Could not save the Cliproom project.'), {status:savedResponse.status});
  return { project_id:args.project_id, revision:saved.revision, dry_run:false, changed:true, changes, warnings };
}
async function pixelProject(requested) {
  if (path.extname(requested).toLowerCase() !== '.pixelroom') throw new Error('A PixelRoom project must use the .pixelroom extension.');
  const file = await inputPath(requested), stat = await fs.stat(file);
  if (stat.size > 128 * 1024 * 1024) throw new Error('PixelRoom project exceeds the 128 MiB agent limit.');
  const bytes = await fs.readFile(file), revision = crypto.createHash('sha256').update(bytes).digest('hex');
  if(bytes.length>128*1024*1024)throw new Error('PixelRoom project exceeds the 128 MiB agent limit.');
  let project; try { project = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('PixelRoom project is not valid JSON.'); }
  if (project?.format !== 'pixelroom-project' || ![1,2].includes(project.version) || !Number.isInteger(project.width)||!Number.isInteger(project.height)||project.width<1||project.height<1||project.width>20000||project.height>20000||!Array.isArray(project.layers) || project.layers.length > 1000) throw new Error('Unsupported PixelRoom project.');
  for(const layer of project.layers)for(const key of ['layerMask','gradeMask'])if(layer?.[key]){if(project.version!==2||layer.type!=='image')throw new Error('Unsupported PixelRoom layer mask.');PixelLayerMask.validate(layer[key]);}
  const layers = project.layers.filter(layer => layer?.type === 'image');
  for (const layer of layers) Grade.readTarget(layer,'pixel');
  return {project, layers, revision};
}
export async function inspectPixelProject(args) {
  const { project, layers, revision } = await pixelProject(args.path);
  return { revision, name:project.name || '', layers:layers.map(layer => ({id:layer.id,name:layer.name || '',has_mask:!!layer.layerMask,has_grade_mask:!!layer.gradeMask,grade:summary(Grade.readTarget(layer,'pixel'))})),...(args.include_all?{width:project.width,height:project.height,all_layers:project.layers.map(pixelLayerSummary)}:{}) };
}
function pixelLayerSummary(layer,index){const keys=['name','x','y','w','h','rotation','opacity','visible','shape','color','strokeColor','strokeWidth','roundness','sides','innerRadius','text','font','fontSize','letterSpacing','lineHeight','widthScale','align','bold','italic','fitOriginalWidth'],properties={};for(const key of keys){const value=layer?.[key];if(typeof value==='string')properties[key]=value.slice(0,key==='text'?10000:160);else if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))properties[key]=value;}return {id:typeof layer?.id==='string'?layer.id.slice(0,160):null,type:layer?.type,index,...properties,...(typeof layer?.text==='string'&&layer.text.length>10000?{text_truncated:true}:{}),...(layer?.type==='text'?{has_original_lettering:!!layer.original}:{}),...(layer?.type==='image'?{has_mask:!!layer.layerMask,has_grade_mask:!!layer.gradeMask}:{})};}
async function savePixelCopy(project,args,revision,details){if(project.version===1&&project.layers.some(layer=>layer?.colorGrade||layer?.layerMask||layer?.gradeMask)){project.version=2;details.changed=true;}const changed=details.changed;if(args.dry_run)return {...details,dry_run:true,base_revision:revision};if(!args.output)throw new Error('Provide output for a non-dry-run edit.');const output=await outputPath(args.output,['.pixelroom']),data=Buffer.from(JSON.stringify(project));if(data.length>128*1024*1024)throw new Error('PixelRoom project exceeds the 128 MiB agent limit.');await fs.writeFile(output,data,{flag:'wx',mode:0o600});return {...details,changed,dry_run:false,path:output,bytes:data.length,base_revision:revision,revision:crypto.createHash('sha256').update(data).digest('hex')};}
export async function updatePixelLayer(args){
  for(const [field,action]of [['properties','update'],['position','reorder'],['new_layer_id','duplicate']])if(args[field]!==undefined&&args.action!==action)throw new Error(field+' applies only to '+action+'.');if(args.action==='reorder'&&args.position===undefined)throw new Error('Choose a reorder position.');
  const {project,revision}=await pixelProject(args.project_path);if(revision!==args.base_revision)throw Object.assign(new Error('The PixelRoom project changed. Inspect it again before editing a layer.'),{status:409});const matches=project.layers.map((layer,index)=>({layer,index})).filter(value=>value.layer?.id===args.layer_id);if(matches.length!==1)throw new Error('The layer ID is missing or ambiguous.');const {layer,index}=matches[0];if(!['image','text','shape'].includes(layer.type))throw new Error('This layer type is not supported.');
  if(!Number.isFinite(layer.x)||!Number.isFinite(layer.y))throw new Error('The layer position is invalid.');
  const before=pixelLayerSummary(layer,index),original=JSON.stringify(project.layers),details={action:args.action,layer_id:layer.id,before};
  if(args.action==='update'){
    const properties=args.properties;if(!properties||!Object.keys(properties).length)throw new Error('Provide layer properties to update.');const allowed=['name','visible','opacity','x','y','rotation',...(['image','shape'].includes(layer.type)?['width','height']:[]),...(['text','shape'].includes(layer.type)?['color']:[]),...(layer.type==='shape'?['stroke_color','stroke_width','roundness','sides','inner_radius']:[]),...(layer.type==='text'?['text','font','font_size','letter_spacing','line_height','width_scale','align','bold','italic','fit_original_width']:[])];for(const key of Object.keys(properties))if(!allowed.includes(key))throw new Error('Property '+key+' is not available for '+layer.type+' layers.');
    if(layer.type==='shape'&&properties.sides!==undefined&&!['polygon','star'].includes(layer.shape))throw new Error('Sides apply only to polygon and star layers.');if(layer.type==='shape'&&properties.inner_radius!==undefined&&layer.shape!=='star')throw new Error('Inner radius applies only to stars.');if(layer.type==='shape'&&properties.roundness!==undefined&&['circle','line'].includes(layer.shape))throw new Error('Roundness is not available for this shape.');
    const nextFont=properties.font??layer.font;if(properties.font!==undefined&&!['Arial','Georgia','Verdana','monospace',...(project.fonts||[]).map(font=>font.family),...(layer.original?['__pixelroom_original__']:[])].includes(properties.font))throw new Error('The requested font is not available in this project.');if(properties.fit_original_width!==undefined&&nextFont!=='__pixelroom_original__')throw new Error('Original-width fitting applies only to original lettering.');if((properties.bold!==undefined||properties.italic!==undefined)&&nextFont==='__pixelroom_original__')throw new Error('Original lettering does not support bold or italic.');
    if(layer.type==='image'&&(properties.width!==undefined||properties.height!==undefined)){if(!Number.isFinite(layer.w)||!Number.isFinite(layer.h)||layer.w<=0||layer.h<=0)throw new Error('The image layer has invalid dimensions.');const scale=properties.width!==undefined?properties.width/layer.w:properties.height/layer.h,expectedW=layer.w*scale,expectedH=layer.h*scale;if(properties.width!==undefined&&properties.height!==undefined&&Math.abs(properties.height-expectedH)>.01)throw new Error('Image resizing preserves the original layer aspect ratio.');if(expectedW>20000||expectedH>20000||expectedW<4||expectedH<4)throw new Error('The resized image must fit within 4–20,000 pixels per side.');layer.w=expectedW;layer.h=expectedH;}
    const names={width:'w',height:'h',stroke_color:'strokeColor',stroke_width:'strokeWidth',inner_radius:'innerRadius',font_size:'fontSize',letter_spacing:'letterSpacing',line_height:'lineHeight',width_scale:'widthScale',fit_original_width:'fitOriginalWidth'};for(const [key,value]of Object.entries(properties)){if(layer.type==='image'&&['width','height'].includes(key))continue;layer[names[key]||key]=value;}details.after=pixelLayerSummary(layer,index);
  }else if(args.action==='duplicate'){
    if(project.layers.length>=1000)throw new Error('The project already has 1,000 layers.');const id=args.new_layer_id||'layer-'+crypto.randomUUID();if(project.layers.some(item=>item?.id===id))throw new Error('The new layer ID is already in use.');const copy=structuredClone(layer);copy.id=id;copy.name=(String(copy.name||'Layer')+' copy').slice(0,60);copy.x+=project.width*.025;copy.y+=project.height*.025;project.layers.push(copy);details.new_layer=pixelLayerSummary(copy,project.layers.length-1);details.after=pixelLayerSummary(layer,index);
  }else if(args.action==='remove'){project.layers.splice(index,1);details.after=null;details.warnings=['The input project and source pixels were not changed.'];}
  else if(args.action==='reorder'){const to=args.position==='up'?Math.min(project.layers.length-1,index+1):args.position==='down'?Math.max(0,index-1):args.position==='front'?project.layers.length-1:0;project.layers.splice(index,1);project.layers.splice(to,0,layer);details.after=pixelLayerSummary(layer,to);}
  else throw new Error('Unknown layer action.');
  details.changed=original!==JSON.stringify(project.layers);return savePixelCopy(project,args,revision,details);
}
export async function addPixelLayer(args,signal){
  const {project,revision}=await pixelProject(args.project_path);if(revision!==args.base_revision)throw Object.assign(new Error('The PixelRoom project changed. Inspect it again before adding a layer.'),{status:409});if(project.layers.length>=1000)throw new Error('The project already has 1,000 layers.');
  for(const [field,type]of [['text','text'],['text_preset','text'],['shape','shape'],['input','image']])if(args[field]!==undefined&&args.type!==type)throw new Error(field+' applies only to '+type+' layers.');if(args.type==='shape'&&!args.shape)throw new Error('Choose a shape.');if(args.type==='image'&&!args.input)throw new Error('Provide an image input.');
  const id=args.new_layer_id||'layer-'+crypto.randomUUID();if(project.layers.some(item=>item?.id===id))throw new Error('The new layer ID is already in use.');let layer,warnings=[];
  if(args.type==='text'){const body=args.text_preset==='body',text=args.text??(body?'A little note':'Your text here');layer={id,type:'text',name:(text.split('\n')[0]||'Text').slice(0,60),text,x:project.width*.15,y:project.height*.2,w:1,h:1,fontSize:Math.max(28,Math.round(project.width*(body?.028:.075))),font:body?'Arial':'Georgia',color:'#ffffff',bold:false,italic:false,opacity:1,visible:true};}
  else if(args.type==='shape'){const shape=args.shape;layer={id,type:'shape',shape,name:shape[0].toUpperCase()+shape.slice(1),x:project.width*.25,y:project.height*.25,w:project.width*.25,h:shape==='line'?Math.max(8,project.height*.012):project.height*.22,color:'#c9b9ef',strokeColor:'#5f50a2',strokeWidth:0,rotation:0,roundness:0,sides:5,innerRadius:50,opacity:1,visible:true};}
  else{
    const input=await inputPath(args.input),stat=await fs.stat(input),extension=path.extname(input).toLowerCase();if(!['.png','.jpg','.jpeg','.webp','.gif','.avif'].includes(extension)||stat.size>20*1024*1024)throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF image up to 20 MiB.');
    const image=await withRoom('/pixelroom/','Pixelroom',signal,async page=>{await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='agentAddImage';document.body.append(input);});await page.locator('#agentAddImage').setInputFiles(input);return page.evaluate(async()=>{const file=document.querySelector('#agentAddImage').files[0];let bitmap;try{bitmap=await createImageBitmap(file);if(!bitmap.width||!bitmap.height||bitmap.width>20000||bitmap.height>20000||bitmap.width*bitmap.height>40000000)throw new Error('The image must fit within 20,000 pixels per side and 40 megapixels.');const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');if(!context)throw new Error('This browser cannot prepare the image.');context.drawImage(bitmap,0,0);const data=canvas.toDataURL('image/png');if(!data.startsWith('data:image/png;base64,'))throw new Error('This browser could not encode the image.');return {width:bitmap.width,height:bitmap.height,data};}finally{bitmap?.close();}});});
    const scale=Math.min(project.width*.7/image.width,project.height*.7/image.height,1),w=image.width*scale,h=image.height*scale;layer={id,type:'image',name:path.parse(input).name.slice(0,60)||'Image',x:(project.width-w)/2,y:(project.height-h)/2,w,h,image:image.data,opacity:1,visible:true,brightness:0,contrast:0,saturation:0};if(extension==='.gif')warnings.push('Only the first GIF frame is included.');
  }
  project.layers.push(layer);return savePixelCopy(project,args,revision,{action:'add',changed:true,new_layer:pixelLayerSummary(layer,project.layers.length-1),warnings});
}
export async function convertPixelText(args,signal){
  const {project,revision}=await pixelProject(args.project_path);if(revision!==args.base_revision)throw Object.assign(new Error('The PixelRoom project changed. Inspect it again before converting text.'),{status:409});const matches=project.layers.filter(layer=>layer?.id===args.layer_id);if(matches.length!==1||matches[0].type!=='image')throw new Error('Choose one unambiguous image layer.');const layer=matches[0];if(layer.layerMask||layer.gradeMask)throw new Error('This image has an editable mask. Apply or remove it explicitly before converting the isolated pixels to text.');if(!args.dry_run&&!args.output)throw new Error('Provide output for a non-dry-run conversion.');
  const input=await inputPath(args.project_path),out=args.dry_run?null:await outputPath(args.output,['.pixelroom']);return withRoom('/pixelroom/','Pixelroom',signal,async page=>{
    await page.locator('#projectInput').setInputFiles(input);await page.waitForFunction(()=>document.querySelector('#toast').classList.contains('show'),null,{timeout:60000});const message=await page.locator('#toast').textContent();if(!message.includes('Project opened'))throw new Error(message||'Could not open this project.');
    const selected=await page.evaluate(id=>{const row=[...document.querySelectorAll('#layersList [data-layer]')].find(node=>node.dataset.layer===id);if(!row)return false;row.click();return true;},args.layer_id);if(!selected)throw new Error('The layer could not be selected in this project.');
    await page.locator('[data-image-action="editable"]').click();if(!await page.locator('#textConversionDialog').isVisible())throw new Error(await page.locator('#toast').textContent()||'First isolate the letters in a transparent image layer.');
    if((args.language||'eng')!=='eng'){await page.locator('#conversionLanguage').selectOption(args.language);await page.locator('#readTextAgain').click();}
    await page.waitForFunction(()=>!document.querySelector('#readTextAgain').disabled&&!document.querySelector('#conversionStatus').textContent.includes('Reading'),null,{timeout:180000});const recognized=(await page.locator('#conversionText').inputValue()).trim();if(args.text!==undefined)await page.locator('#conversionText').fill(args.text);const text=(await page.locator('#conversionText').inputValue()).trim();if(!text)throw new Error('The letters could not be read. Supply corrected text to complete the conversion.');
    await page.locator('#createEditableTextBtn').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Editable text layer created'));
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#saveProjectBtn').click()]),file=await download.path();if(!file)throw new Error('The editor could not prepare the converted project.');const data=await fs.readFile(file);if(data.length>128*1024*1024)throw new Error('PixelRoom project exceeds the 128 MiB agent limit.');const converted=JSON.parse(data.toString('utf8')),resultLayer=converted.layers.find(item=>item.id===args.layer_id);if(resultLayer?.type!=='text'||!resultLayer.original)throw new Error('The editor did not produce original lettering.');
    const warnings=['The selected image is replaced in the output copy. Its source pixels and image color adjustments are not carried into the text layer; the input project is unchanged.','Recognition and substitute glyphs are approximate; review the words and appearance.'];let result={dry_run:!!args.dry_run,changed:true,base_revision:revision,layer_id:args.layer_id,recognized_text:recognized,text,glyphs:resultLayer.original.glyphs.length,warnings};
    if(out){await fs.writeFile(out,data,{flag:'wx',mode:0o600});result={...result,path:out,bytes:data.length,revision:crypto.createHash('sha256').update(data).digest('hex')};}
    if(!args.include_preview)return result;
    try{if(project.width*project.height>16000000)throw new Error('Preview is limited to 16 megapixels.');await page.locator('#exportBtn').click();const [image]=await Promise.all([page.waitForEvent('download'),page.locator('#downloadBtn').click()]),imagePath=await image.path();await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='roomsuitePreviewFile';document.body.append(input);});await page.locator('#roomsuitePreviewFile').setInputFiles(imagePath);return attachPreview(result,await previewOnPage(page,{kind:'image',maxDimension:args.preview_max_dimension}));}catch(error){return {...result,preview_error:'Conversion succeeded, but preview failed: '+error.message};}
  });
}
export async function isolatePixelTextRegion(args,signal){
  const {project,revision}=await pixelProject(args.project_path);if(revision!==args.base_revision)throw Object.assign(new Error('The PixelRoom project changed. Inspect it again before isolating text.'),{status:409});
  const matches=project.layers.filter(layer=>layer?.id===args.layer_id);if(matches.length!==1||matches[0].type!=='image')throw new Error('Choose one unambiguous image layer.');const layer=matches[0];
  if(layer.layerMask||layer.gradeMask)throw new Error('This image has an editable mask. Apply or remove it before isolating text.');
  if((Number(layer.rotation)||0)%360!==0)throw new Error('Select an unrotated image layer for a precise rectangular region.');
  const {x,y,width,height}=args.region;if(x+width>1||y+height>1)throw new Error('The normalized region must fit within the image layer.');
  if(![layer.x,layer.y,layer.w,layer.h].every(Number.isFinite)||layer.w<=0||layer.h<=0)throw new Error('The image layer has invalid dimensions.');
  const box={x:layer.x+x*layer.w,y:layer.y+y*layer.h,w:width*layer.w,h:height*layer.h};
  if(box.x<0||box.y<0||box.x+box.w>project.width||box.y+box.h>project.height||box.w<4||box.h<4)throw new Error('The selected region must fit inside the canvas and cover at least four canvas pixels per side.');
  if(args.color_sample&&(args.color_sample.x<x||args.color_sample.x>x+width||args.color_sample.y<y||args.color_sample.y>y+height))throw new Error('The letter-color sample must lie inside the selected region.');
  if(args.new_layer_id&&project.layers.some(item=>item?.id===args.new_layer_id))throw new Error('The new layer ID is already in use.');
  if(!args.dry_run&&!args.output)throw new Error('Provide output for a non-dry-run conversion.');const input=await inputPath(args.project_path),out=args.dry_run?null:await outputPath(args.output,['.pixelroom']);
  return withRoom('/pixelroom/','Pixelroom',signal,async page=>{
    await page.locator('#projectInput').setInputFiles(input);await page.waitForFunction(()=>document.querySelector('#toast').classList.contains('show'),null,{timeout:60000});const message=await page.locator('#toast').textContent();if(!message.includes('Project opened'))throw new Error(message||'Could not open this project.');
    if(!await page.evaluate(id=>{const row=[...document.querySelectorAll('#layersList [data-layer]')].find(node=>node.dataset.layer===id);if(!row)return false;row.click();return true;},args.layer_id))throw new Error('The layer could not be selected in this project.');
    await page.locator('[data-tab="isolate"]').click();await page.locator('#ocrLanguage').selectOption(args.language||'eng');await page.locator('#findTextBtn').click();await page.locator('#drawTextSelectionBtn').click();
    const canvas=page.locator('#editorCanvas');await canvas.scrollIntoViewIfNeeded();const rect=await canvas.boundingBox();if(!rect)throw new Error('The image canvas is unavailable.');
    const point=(px,py)=>({x:rect.x+px/project.width*rect.width,y:rect.y+py/project.height*rect.height}),from=point(box.x,box.y),to=point(box.x+box.w,box.y+box.h);
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:3});await page.mouse.up();await page.locator('#isolateTextBtn').click();
    if(args.tolerance!==undefined)await page.locator('#maskTolerance').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},args.tolerance);
    if(args.color_sample){const sample=point(layer.x+args.color_sample.x*layer.w,layer.y+args.color_sample.y*layer.h);await page.mouse.click(sample.x,sample.y);}
    if(!args.rebuild_background)await page.locator('#inpaintOriginal').uncheck();await page.locator('#applyMaskBtn').click();
    if(args.rebuild_background){await page.waitForFunction(()=>document.querySelector('#maskTitle').textContent==='Review the rebuilt background'||document.querySelector('#maskHint').textContent.includes('Cleanup could not run'),null,{timeout:180000});if((await page.locator('#maskTitle').textContent())!=='Review the rebuilt background')throw new Error('The local background cleanup model could not run.');await page.locator('#applyMaskBtn').click();}
    if(!await page.locator('#textConversionDialog').isVisible())throw new Error(await page.locator('#toast').textContent()||'No letters were selected.');
    await page.waitForFunction(()=>!document.querySelector('#readTextAgain').disabled&&!document.querySelector('#conversionStatus').textContent.includes('Reading'),null,{timeout:180000});const recognized=(await page.locator('#conversionText').inputValue()).trim();if(args.text!==undefined)await page.locator('#conversionText').fill(args.text);const text=(await page.locator('#conversionText').inputValue()).trim();if(!text)throw new Error('The letters could not be read. Supply corrected text to complete the conversion.');
    await page.locator('#createEditableTextBtn').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Editable text layer created'));
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#saveProjectBtn').click()]),file=await download.path();if(!file)throw new Error('The editor could not prepare the converted project.');let data=await fs.readFile(file);if(data.length>128*1024*1024)throw new Error('PixelRoom project exceeds the 128 MiB agent limit.');const converted=JSON.parse(data.toString('utf8')),oldIds=new Set(project.layers.map(item=>item.id)),created=converted.layers.filter(item=>item.type==='text'&&!oldIds.has(item.id));if(created.length!==1||!created[0].original)throw new Error('The editor did not produce one original-lettering layer.');const resultLayer=created[0];if(args.new_layer_id){resultLayer.id=args.new_layer_id;data=Buffer.from(JSON.stringify(converted));}
    if((await pixelProject(args.project_path)).revision!==revision)throw Object.assign(new Error('The PixelRoom project changed during conversion. Inspect it again.'),{status:409});
    const warnings=[args.rebuild_background?'Background rebuilding changed the selected image in the output copy; inspect the result.':'The original letters remain in the image beneath the new text layer. Enable background rebuilding or edit the source separately if needed.','The selection and OCR are approximate; review the mask, words and glyphs. Image color adjustments are not transferred to the text layer.'];
    let result={dry_run:!!args.dry_run,changed:true,base_revision:revision,source_layer_id:args.layer_id,layer_id:resultLayer.id,recognized_text:recognized,text,glyphs:resultLayer.original.glyphs.length,rebuild_background:!!args.rebuild_background,warnings};
    if(out){await fs.writeFile(out,data,{flag:'wx',mode:0o600});result={...result,path:out,bytes:data.length,revision:crypto.createHash('sha256').update(data).digest('hex')};}
    if(!args.include_preview)return result;try{if(project.width*project.height>16000000)throw new Error('Preview is limited to 16 megapixels.');await page.locator('#exportBtn').click();const [image]=await Promise.all([page.waitForEvent('download'),page.locator('#downloadBtn').click()]),imagePath=await image.path();await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='roomsuitePreviewFile';document.body.append(input);});await page.locator('#roomsuitePreviewFile').setInputFiles(imagePath);return attachPreview(result,await previewOnPage(page,{kind:'image',maxDimension:args.preview_max_dimension}));}catch(error){return {...result,preview_error:'Conversion succeeded, but preview failed: '+error.message};}
  });
}
export async function applyPixelMask(args,signal){
  const {project,layers,revision}=await pixelProject(args.project_path);if(revision!==args.base_revision)throw Object.assign(new Error('The PixelRoom project changed. Inspect it again before changing a mask.'),{status:409});const matches=layers.filter(layer=>layer.id===args.layer_id);if(matches.length!==1)throw new Error('The image layer ID is missing or ambiguous.');const layer=matches[0],target=args.target||'cutout',key=target==='grade'?'gradeMask':'layerMask',before=layer[key];
  if(args.action==='remove'){if(args.mask_path!==undefined||args.channel!==undefined)throw new Error('Mask input and channel only apply when setting a mask.');delete layer[key];}
  else{if(!args.mask_path)throw new Error('Provide mask_path to set a mask.');if(typeof layer.image!=='string'||!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(layer.image))throw new Error('The image layer does not contain a supported embedded image.');const input=await inputPath(args.mask_path),stat=await fs.stat(input);if(path.extname(input).toLowerCase()!=='.png'||stat.size>PixelLayerMask.maxBytes)throw new Error('Choose a PNG mask up to 16 MiB.');
    const mask=await withRoom('/pixelroom/','Pixelroom',signal,async page=>{await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='agentLayerMask';document.body.append(input);});await page.locator('#agentLayerMask').setInputFiles(input);return page.evaluate(async({channel,source})=>{const file=document.querySelector('#agentLayerMask').files[0],header=new Uint8Array(await file.slice(0,8).arrayBuffer());if(header.length!==8||[137,80,78,71,13,10,26,10].some((n,i)=>header[i]!==n))throw new Error('Choose a PNG mask.');const maskUrl=URL.createObjectURL(file);try{const load=url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not decode the image or mask.'));image.src=url;});const [image,original]=await Promise.all([load(maskUrl),load(source)]);PixelLayerMask.dimensions(image.naturalWidth,image.naturalHeight);if(!PixelLayerMask.compatible(image.naturalWidth,image.naturalHeight,original.naturalWidth,original.naturalHeight))throw new Error('The mask must have the same aspect ratio as the image layer.');return PixelLayerMask.encode(PixelLayerMask.fromImage(image,channel));}finally{URL.revokeObjectURL(maskUrl);}},{channel:args.channel||'alpha',source:layer.image});});layer[key]=mask;project.version=2;
  }
  const changed=JSON.stringify(before||null)!==JSON.stringify(layer[key]||null);if(args.dry_run)return {dry_run:true,changed,base_revision:revision,layer_id:args.layer_id,target,had_mask:!!before,has_mask:!!layer[key]};if(!args.output)throw new Error('Provide output for a non-dry-run edit.');const output=await outputPath(args.output,['.pixelroom']),data=Buffer.from(JSON.stringify(project));if(data.length>128*1024*1024)throw new Error('PixelRoom project exceeds the 128 MiB agent limit.');await fs.writeFile(output,data,{flag:'wx',mode:0o600});return {dry_run:false,changed,path:output,bytes:data.length,base_revision:revision,revision:crypto.createHash('sha256').update(data).digest('hex'),layer_id:args.layer_id,target,had_mask:!!before,has_mask:!!layer[key]};
}
export async function applyPixelGrade(args) {
  const resolved = await requestedGrade(args), { project, layers, revision } = await pixelProject(args.project_path);
  if (revision !== args.base_revision) throw Object.assign(new Error('The PixelRoom project changed. Inspect it again before applying a grade.'), {status:409});
  const matches = layers.filter(layer => layer.id === args.layer_id);
  if (matches.length !== 1) throw new Error('The image layer ID is missing or ambiguous.');
  const layer = matches[0], before = Grade.readTarget(layer,'pixel');
  Grade.writeTarget(layer,'pixel',resolved?.adjustments||before.adjustments,args.strength ?? before.strength,args.enabled ?? (resolved ? true : before.enabled),requestedLook(before,resolved));
  const priorVersion=project.version;project.version=2;const after = Grade.readTarget(layer,'pixel'), changed = priorVersion!==project.version||JSON.stringify(before) !== JSON.stringify(after),beforeSummary=summary(before),afterSummary=summary(after);
  if (args.dry_run) return { dry_run:true, changed, base_revision:revision, layer_id:args.layer_id, before:beforeSummary, after:afterSummary };
  if (!args.output) throw new Error('Provide output for a non-dry-run edit.');
  const output = await outputPath(args.output, ['.pixelroom']), bytes = Buffer.from(JSON.stringify(project));
  await fs.writeFile(output, bytes, { flag:'wx', mode:0o600 });
  return { dry_run:false, changed, path:output, bytes:bytes.length, base_revision:revision, revision:crypto.createHash('sha256').update(bytes).digest('hex'), layer_id:args.layer_id, before:beforeSummary, after:afterSummary };
}
export async function analyzeColor(args, signal) {
  const input = await inputPath(args.input),stat=await fs.stat(input);if(stat.size>20*1024*1024)throw new Error('Images must be 20 MiB or smaller for color analysis.');
  return withRoom('/pixelroom/','Pixelroom',signal,async page=>{
    await page.evaluate(() => { const input=document.createElement('input');input.type='file';input.id='gradeProbe';document.body.append(input); });
    await page.locator('#gradeProbe').setInputFiles(input);
    return page.evaluate(async () => {
      const file=document.querySelector('#gradeProbe').files[0];if(!file.type.startsWith('image/'))throw new Error('Choose an image file.');
      const image=await createImageBitmap(file);if(image.width*image.height>40000000){image.close();throw new Error('Images must be 40 megapixels or smaller for color analysis.');}const scale=Math.min(1,512/Math.max(image.width,image.height));
      const sample=document.createElement('canvas');sample.width=Math.max(1,Math.round(image.width*scale));sample.height=Math.max(1,Math.round(image.height*scale));
      const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,sample.width,sample.height);image.close();
      const data=ctx.getImageData(0,0,sample.width,sample.height).data, histogram=Array(16).fill(0),sum=[0,0,0];let count=0,clippedDark=0,clippedLight=0;
      for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;const r=data[i],g=data[i+1],b=data[i+2],l=.2126*r+.7152*g+.0722*b;histogram[Math.min(15,Math.floor(l/16))]++;sum[0]+=r;sum[1]+=g;sum[2]+=b;count++;if(r<=2&&g<=2&&b<=2)clippedDark++;if(r>=253||g>=253||b>=253)clippedLight++;}
      return {sample_width:sample.width,sample_height:sample.height,pixels:count,histogram,mean_rgb:sum.map(value=>count?Math.round(value/count*100)/100:0),dark_clipped_fraction:count?clippedDark/count:0,light_clipped_fraction:count?clippedLight/count:0,note:'Approximate display-referred RGB statistics from a maximum 512-pixel preview; partially transparent pixels count equally. This is not an aesthetic judgment.'};
    });
  });
}
export async function previewPreset(args,signal){
  const file=await inputPath(args.input),stat=await fs.stat(file);if(stat.size>128*1024*1024)throw new Error('Preview media must be 128 MiB or smaller.');
  const request=await requestedGrade(args),target={},before=Grade.readTarget(target,'pixel');
  Grade.writeTarget(target,'pixel',request?.adjustments||before.adjustments,args.strength??100,args.enabled??true,requestedLook(before,request));
  const grade=Grade.readTarget(target,'pixel');
  return withRoom('/cliproom/','Cliproom',signal,async page=>{
    await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='preset-preview-probe';document.body.append(input);});await page.locator('#preset-preview-probe').setInputFiles(file);
    const result=await page.evaluate(async({grade,times,limit})=>{
      const file=document.querySelector('#preset-preview-probe').files[0],image=file.type.startsWith('image/'),video=file.type.startsWith('video/');if(!image&&!video)throw new Error('Choose an image or video file.');
      if(image&&times?.some(time=>time!==0))throw new Error('Image previews support only time 0.');
      const url=URL.createObjectURL(file);let media;
      try{
        if(image){media=new Image();media.src=url;await media.decode();}else{media=document.createElement('video');media.muted=true;media.preload='auto';media.src=url;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Video preview timed out.')),20000);media.onloadeddata=()=>{clearTimeout(timer);resolve();};media.onerror=()=>{clearTimeout(timer);reject(new Error('The browser cannot decode this video.'));};});if(!Number.isFinite(media.duration)||media.duration<=0)throw new Error('The video duration is unavailable.');}
        const sw=image?media.naturalWidth:media.videoWidth,sh=image?media.naturalHeight:media.videoHeight;if(!sw||!sh||sw*sh>40000000)throw new Error('Preview dimensions must be at most 40 megapixels.');
        const samples=image?[0]:(times?.length?times:[0]);if(video&&samples.some(time=>time<0||time>=media.duration))throw new Error('Preview times must be inside the video duration.');
        const cellWidth=Math.floor(limit/2),cellHeight=Math.floor((limit-samples.length*26)/samples.length),scale=Math.min(1,cellWidth/sw,cellHeight/sh),w=Math.max(1,Math.round(sw*scale)),h=Math.max(1,Math.round(sh*scale));
        let sheet=document.createElement('canvas');sheet.width=w*2;sheet.height=(h+26)*samples.length;const sheetCtx=sheet.getContext('2d');sheetCtx.fillStyle='#f3f1f7';sheetCtx.fillRect(0,0,sheet.width,sheet.height);sheetCtx.font='12px sans-serif';sheetCtx.textBaseline='middle';
        const values=RoomGrade.effective(grade),frames=[];
        const stats=canvas=>{const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data,sum=[0,0,0];let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]){sum[0]+=pixels[i];sum[1]+=pixels[i+1];sum[2]+=pixels[i+2];count++;}return sum.map(value=>count?Math.round(value/count*100)/100:0);};
        for(let index=0;index<samples.length;index++){
          const at=samples[index];if(video&&Math.abs(media.currentTime-at)>.0001){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Video seek timed out.')),20000);media.onseeked=()=>{clearTimeout(timer);resolve();};media.onerror=()=>{clearTimeout(timer);reject(new Error('The browser could not seek the video.'));};media.currentTime=at;});}
          const original=document.createElement('canvas');original.width=w;original.height=h;original.getContext('2d').drawImage(media,0,0,w,h);
          const adjusted=document.createElement('canvas');adjusted.width=w;adjusted.height=h;const context=adjusted.getContext('2d');context.filter=RoomGrade.cssFilter(values);context.drawImage(RoomGrade.renderSource(original,values,w,h,false),0,0,w,h);
          const y=index*(h+26);sheetCtx.fillStyle='#ffffff';sheetCtx.fillRect(0,y,w*2,h);sheetCtx.drawImage(original,0,y);sheetCtx.drawImage(adjusted,w,y);sheetCtx.fillStyle='#302a3a';sheetCtx.fillText('Before · '+at.toFixed(2)+'s',6,y+h+13,w-12);sheetCtx.fillText('After · '+at.toFixed(2)+'s',w+6,y+h+13,w-12);
          frames.push({time_seconds:at,mean_before_rgb:stats(original),mean_after_rgb:stats(adjusted)});
        }
        let encoded=sheet.toDataURL('image/png');while(encoded.length>1400000&&Math.max(sheet.width,sheet.height)>256){const smaller=document.createElement('canvas');smaller.width=Math.max(1,Math.round(sheet.width*.8));smaller.height=Math.max(1,Math.round(sheet.height*.8));smaller.getContext('2d').drawImage(sheet,0,0,smaller.width,smaller.height);sheet=smaller;encoded=sheet.toDataURL('image/png');}
        const data=encoded.slice(encoded.indexOf(',')+1),bytes=Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0);
        return {frames,preview:{data,width:sheet.width,height:sheet.height,bytes,mime_type:'image/png'}};
      }finally{if(media&&video){media.pause();media.removeAttribute('src');media.load();}URL.revokeObjectURL(url);}
    },{grade,times:args.times,limit:args.max_dimension||1024});
    return attachPreview({kind:'before_after',media_type:path.extname(args.input).toLowerCase(),grade:summary(grade),frames:result.frames,note:'Frames are resized before grading for a bounded preview; grain and sharpening can differ at export resolution.'},result.preview);
  });
}
