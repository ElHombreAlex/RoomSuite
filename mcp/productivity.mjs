import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import Model from '../ProductivitySuite/model.js';
import Grid from '../ProductivitySuite/grid.js';
import Calendar from '../ProductivitySuite/calendar.js';
import {inputPath,outputPath,saveDownload} from './files.mjs';
import {serverUrl,withRoom} from './rooms.mjs';

const endpoint=path=>'/api/workspace/productivity?'+new URLSearchParams({path});
async function request(route,{method='GET',data,signal}={}){
  const origin=serverUrl(),response=await fetch(origin+route,{method,signal,headers:{...(method==='GET'?{}:{Origin:origin,'X-Cliproom-Request':'1'}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw Object.assign(new Error(body.error||'RoomSuite request failed ('+response.status+').'),{status:response.status});}
  return response;
}
function urlFor(file){const ext=path.extname(file).toLowerCase(),kind=Object.keys(Model.extensions).find(key=>Model.extensions[key]===ext);if(!kind)throw new Error('Unsupported productivity file extension.');return serverUrl()+'/'+kind+'/?'+new URLSearchParams({shared_file:file});}
async function read(file,signal,expected){const result=await (await request(endpoint(file),{signal})).json();Model.validate(result.state,expected);return {...result,url:urlFor(file)};}
async function save(file,baseRevision,state,signal){const result=await (await request(endpoint(file),{method:'PUT',signal,data:{baseRevision,state}})).json();return {...result,url:urlFor(file)};}
async function edit(args,signal,kind,fn){const old=await read(args.path,signal,kind);if(old.revision!==args.base_revision)throw Object.assign(new Error('This file changed or moved. Open the latest version before editing.'),{code:'REVISION_CONFLICT',currentRevision:old.revision});const state=await fn(old.state);return save(args.path,args.base_revision,state,signal);}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const paragraphs=text=>text.split(/\r?\n/).map(line=>'<p>'+(escape(line)||'<br>')+'</p>').join('');
function make(kind,title){const value=Model.empty(kind,()=>crypto.randomUUID());value.title=title;return value;}
async function sharedImage(sharedPath,signal){
  const ext=path.extname(sharedPath).toLowerCase(),type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[ext];
  if(!type)throw new Error('Use a shared PNG, JPEG, WebP or GIF image.');
  const response=await request('/api/workspace/file?'+new URLSearchParams({path:sharedPath}),{signal});
  if(Number(response.headers.get('content-length')||0)>2*1024*1024){await response.body?.cancel();throw new Error('Shared images must be 2 MB or smaller.');}
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>2*1024*1024)throw new Error('Shared images must be 2 MB or smaller.');
  return 'data:'+type+';base64,'+bytes.toString('base64');
}
export const get=(args,signal)=>read(args.path,signal);
export const put=(args,signal)=>save(args.path,args.base_revision,args.state,signal);
export async function docCreate(args,signal){const state=make('docsuite',args.title);state.html=paragraphs(args.text||'');return save(args.path,null,state,signal);}
export const docGet=(args,signal)=>read(args.path,signal,'docsuite');
export const docAppend=(args,signal)=>edit(args,signal,'docsuite',async state=>({...state,html:state.html+paragraphs(args.text)}));
export const docReplace=(args,signal)=>edit(args,signal,'docsuite',async state=>({...state,html:paragraphs(args.text)}));
export const docImage=(args,signal)=>edit(args,signal,'docsuite',async state=>({...state,html:state.html+'<p><img src="'+await sharedImage(args.shared_image,signal)+'" alt="'+escape(args.alt||'')+'"></p>'}));
export const docAddComment=(args,signal)=>edit(args,signal,'docsuite',async state=>({...state,comments:[...state.comments,{id:crypto.randomUUID(),text:args.text,quote:args.quote||'',author:args.author||'',resolved:false}]}));
export const docUpdateComment=(args,signal)=>edit(args,signal,'docsuite',async state=>{if(!state.comments.some(c=>c.id===args.comment_id))throw Object.assign(new Error('Comment not found.'),{code:'NOT_FOUND'});return {...state,comments:state.comments.map(c=>c.id===args.comment_id?{...c,...(args.text===undefined?{}:{text:args.text}),...(args.resolved===undefined?{}:{resolved:args.resolved})}:c)};});
export const docDeleteComment=(args,signal)=>edit(args,signal,'docsuite',async state=>{if(!state.comments.some(c=>c.id===args.comment_id))throw Object.assign(new Error('Comment not found.'),{code:'NOT_FOUND'});return {...state,comments:state.comments.filter(c=>c.id!==args.comment_id)};});
export async function gridCreate(args,signal){const state=make('gridsuite',args.title);state.rows=args.rows||100;state.columns=args.columns||26;state.cells=args.cells||{};return save(args.path,null,state,signal);}
export const gridGet=(args,signal)=>read(args.path,signal,'gridsuite');
function gridSheet(state,name){const sheet=name?state.sheets.find(item=>item.name===name):state.sheets.find(item=>item.id===state.activeSheetId);if(!sheet)throw Object.assign(new Error('Sheet not found: '+name),{code:'NOT_FOUND'});return sheet;}
function gridChange(state,name,change){const sheet=gridSheet(state,name),next=change(sheet),sheets=state.sheets.map(item=>item.id===sheet.id?next:item);return sheet.id===state.activeSheetId?{...state,...next,sheets}:{...state,sheets};}
export const gridSet=(args,signal)=>edit(args,signal,'gridsuite',async state=>gridChange(state,args.sheet_name,sheet=>{const cells={...sheet.cells},types={...sheet.types},formats={...sheet.formats};for(const [address,value] of Object.entries(args.cells)){if(value===''){delete cells[address];delete formats[address];}else cells[address]=value;delete types[address];}return {...sheet,cells,types,formats};}));
export const gridChart=(args,signal)=>edit(args,signal,'gridsuite',async state=>gridChange(state,args.sheet_name,sheet=>({...sheet,chart:args.chart})));
export const gridFilter=(args,signal)=>edit(args,signal,'gridsuite',async state=>gridChange(state,args.sheet_name,sheet=>({...sheet,filter:args.filter})));
export const gridResize=(args,signal)=>edit(args,signal,'gridsuite',async state=>gridChange(state,args.sheet_name,sheet=>({...sheet,rows:args.rows??sheet.rows,columns:args.columns??sheet.columns})));
export const gridSort=(args,signal)=>edit(args,signal,'gridsuite',async state=>gridChange(state,args.sheet_name,sheet=>{const column=Grid.address(args.column+'1').col;if(column>=sheet.columns)throw new Error('Column is outside the spreadsheet.');if(Object.keys(sheet.types||{}).length||Object.keys(sheet.formats||{}).length||Object.keys(sheet.styles||{}).length)throw new Error('Sorting imported cell formats is not supported yet.');return {...sheet,cells:Grid.sortRows(sheet.cells,args.column,args.descending===true)};}));
export const gridAddSheet=(args,signal)=>edit(args,signal,'gridsuite',async state=>{const sheet={id:crypto.randomUUID(),name:args.name,rows:100,columns:26,cells:{},chart:null,types:{},formats:{}};return {...state,sheets:[...state.sheets,sheet]};});
export const gridSelectSheet=(args,signal)=>edit(args,signal,'gridsuite',async state=>{const sheet=gridSheet(state,args.sheet_name);return {...state,rows:sheet.rows,columns:sheet.columns,cells:sheet.cells,chart:sheet.chart,types:sheet.types,formats:sheet.formats,styles:sheet.styles,filter:sheet.filter,activeSheetId:sheet.id};});
export async function gridRead(args,signal){const result=await read(args.path,signal,'gridsuite'),sheet=gridSheet(result.state,args.sheet_name),calc=Grid.calculate(sheet.cells,sheet.rows,sheet.columns,sheet.types);const cells=args.addresses.map(address=>{const pos=Grid.address(address);if(pos.row>=sheet.rows||pos.col>=sheet.columns)throw new Error('Cell is outside the spreadsheet: '+address);return {address,raw:sheet.cells[address]||'',value:calc(address)};});return {path:args.path,revision:result.revision,cells,url:result.url};}
export async function deckCreate(args,signal){const state=make('decksuite',args.title);if(args.slides?.length){state.slides=[];for(const slide of args.slides)state.slides.push({id:crypto.randomUUID(),title:slide.title||'',body:slide.body||'',background:slide.background||'#ffffff',image:slide.shared_image?await sharedImage(slide.shared_image,signal):''});}return save(args.path,null,state,signal);}
export const deckGet=(args,signal)=>read(args.path,signal,'decksuite');
export const deckAdd=(args,signal)=>edit(args,signal,'decksuite',async state=>{const slide={id:crypto.randomUUID(),title:args.title||'',body:args.body||'',background:args.background||'#ffffff',image:args.shared_image?await sharedImage(args.shared_image,signal):''};const index=args.index===undefined?state.slides.length:args.index;if(index>state.slides.length)throw new Error('Slide insertion index is outside the deck.');const slides=[...state.slides];slides.splice(index,0,slide);return {...state,slides};});
export const deckUpdate=(args,signal)=>edit(args,signal,'decksuite',async state=>{const index=state.slides.findIndex(slide=>slide.id===args.slide_id);if(index<0)throw Object.assign(new Error('Slide not found.'),{code:'NOT_FOUND'});if(args.remove_image&&args.shared_image)throw new Error('Choose an image or remove it, not both.');const slides=[...state.slides],old=slides[index];slides[index]={...old,title:args.title??old.title,body:args.body??old.body,background:args.background??old.background,image:args.remove_image?'':args.shared_image?await sharedImage(args.shared_image,signal):old.image};return {...state,slides};});
export const deckDelete=(args,signal)=>edit(args,signal,'decksuite',async state=>{if(!state.slides.some(slide=>slide.id===args.slide_id))throw Object.assign(new Error('Slide not found.'),{code:'NOT_FOUND'});if(state.slides.length<=1)throw new Error('A presentation needs at least one slide.');return {...state,slides:state.slides.filter(slide=>slide.id!==args.slide_id)};});
export const deckTemplate=(args,signal)=>edit(args,signal,'decksuite',async state=>{if(!state.slides.some(slide=>slide.id===args.slide_id))throw Object.assign(new Error('Slide not found.'),{code:'NOT_FOUND'});return {...state,slides:state.slides.map(slide=>slide.id===args.slide_id?{...slide,layout:structuredClone(Model.slideLayouts[args.template])}:slide)};});
export async function planCreate(args,signal){return save(args.path,null,make('plansuite',args.title),signal);}
export const planGet=(args,signal)=>read(args.path,signal,'plansuite');
export const planAdd=(args,signal)=>edit(args,signal,'plansuite',async state=>({...state,events:[...state.events,{id:crypto.randomUUID(),title:args.title,start:args.start,end:args.end,description:args.description||'',remindMinutes:args.remind_minutes??null}]}));
export const planAddMany=(args,signal)=>edit(args,signal,'plansuite',async state=>{const seriesId=args.series?crypto.randomUUID():null;return {...state,events:[...state.events,...args.events.map(event=>({id:crypto.randomUUID(),title:event.title,start:event.start,end:event.end,description:event.description||'',remindMinutes:event.remind_minutes??null,...(seriesId?{seriesId}:{})}))]};});
export const planUpdate=(args,signal)=>edit(args,signal,'plansuite',async state=>({...state,events:Calendar.update(state.events,args.event_id,{title:args.title,start:args.start,end:args.end,description:args.description,remindMinutes:args.remind_minutes},args.scope||'occurrence')}));
export const planDelete=(args,signal)=>edit(args,signal,'plansuite',async state=>({...state,events:Calendar.remove(state.events,args.event_id,args.scope||'occurrence')}));
export async function planList(args,signal){const result=await read(args.path,signal,'plansuite'),from=args.from?Date.parse(args.from):-Infinity,to=args.to?Date.parse(args.to):Infinity;if(Number.isNaN(from)||Number.isNaN(to)||from>=to)throw new Error('Use valid timestamps with from before to.');return {path:args.path,revision:result.revision,events:result.state.events.filter(event=>Date.parse(event.start)<to&&Date.parse(event.end)>from).sort((a,b)=>a.start.localeCompare(b.start)),url:result.url};}
async function artifact(output,data,mime,room,operation,revision){
  let handle;try{handle=await fs.open(output,'wx',0o600);await handle.writeFile(data);await handle.close();handle=null;}catch(error){if(handle){await handle.close().catch(()=>{});await fs.rm(output,{force:true}).catch(()=>{});}if(error.code==='EEXIST')throw new Error('Output already exists: '+output);throw error;}
  return {path:output,bytes:Buffer.byteLength(data),mime_type:mime,room,operation,revision};
}
export async function gridImportCsv(args,signal){
  const source=await inputPath(args.input),stat=await fs.stat(source);if(stat.size>2*1024*1024)throw new Error('CSV files must be 2 MB or smaller.');const rows=Grid.parseCsv(await fs.readFile(source,'utf8'));if(rows.length>500||rows.some(row=>row.length>52||row.some(value=>value.length>5000)))throw new Error('CSV exceeds the GridSuite limits.');
  const state=make('gridsuite',args.title||path.basename(source,path.extname(source))||'Imported spreadsheet');state.rows=Math.max(100,rows.length);state.columns=Math.max(26,...rows.map(row=>row.length));rows.forEach((row,r)=>row.forEach((value,c)=>{if(value)state.cells[Grid.column(c)+(r+1)]=value;}));return save(args.path,null,state,signal);
}
export async function gridExportCsv(args,signal){const result=await read(args.path,signal,'gridsuite'),sheet=gridSheet(result.state,args.sheet_name),out=await outputPath(args.output,['.csv']),keys=Object.keys(sheet.cells).map(Grid.address);let maxRow=0,maxCol=0;for(const key of keys){maxRow=Math.max(maxRow,key.row);maxCol=Math.max(maxCol,key.col);}const calc=Grid.calculate(sheet.cells,sheet.rows,sheet.columns,sheet.types),rows=[];for(let r=0;r<=maxRow;r++){const row=[];for(let c=0;c<=maxCol;c++){const address=Grid.column(c)+(r+1);row.push(args.calculated?calc(address):sheet.cells[address]||'');}rows.push(row);}return artifact(out,Buffer.from(Grid.toCsv(rows),'utf8'),'text/csv','gridsuite','export_csv',result.revision);}
export async function planExportIcs(args,signal){const result=await read(args.path,signal,'plansuite'),out=await outputPath(args.output,['.ics']);return artifact(out,Buffer.from(Calendar.ics(result.state.events),'utf8'),'text/calendar','plansuite','export_ics',result.revision);}
async function exportPdf(args,signal,kind,title){
  const result=await read(args.path,signal,kind),out=await outputPath(args.output,['.pdf']),route='/'+kind+'/?'+new URLSearchParams({shared_file:args.path});
  const pdf=await withRoom(route,title,signal,async page=>{
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('Saved ·')||document.querySelector('#status')?.classList.contains('error'));
    if(await page.locator('#status').evaluate(node=>node.classList.contains('error')))throw new Error('Could not open the file in '+title+'.');
    const latest=await read(args.path,signal,kind);if(latest.revision!==result.revision)throw new Error('The file changed during export. Try again.');
    if(kind==='decksuite'){await page.evaluate(()=>{window.print=()=>{};});await page.locator('#deckPrint').click();}
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(image=>image.src).map(image=>image.decode().catch(()=>{})));});
    await page.emulateMedia({media:'print'});return page.pdf({format:'A4',landscape:kind==='decksuite',printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'12mm',right:'12mm'}});
  });
  return artifact(out,pdf,'application/pdf',kind,'export_pdf',result.revision);
}
export const docExportPdf=(args,signal)=>exportPdf(args,signal,'docsuite','DocSuite');
export const deckExportPdf=(args,signal)=>exportPdf(args,signal,'decksuite','DeckSuite');
const officeInfo={docsuite:{ext:'.docx',title:'DocSuite',read:'readDocx',write:'writeDocx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},gridsuite:{ext:'.xlsx',title:'GridSuite',read:'readXlsx',write:'writeXlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},decksuite:{ext:'.pptx',title:'DeckSuite',read:'readPptx',write:'writePptx',mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}};
async function importOffice(args,signal,kind){
  const info=officeInfo[kind],source=await inputPath(args.input),stat=await fs.stat(source);if(stat.size>20*1024*1024)throw new Error('Office files must be 20 MB or smaller.');
  const imported=await withRoom('/'+kind+'/',info.title,signal,async page=>{await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='agentOfficeInput';document.body.append(input);});await page.locator('#agentOfficeInput').setInputFiles(source);return page.evaluate(async({method,kind})=>{const file=document.querySelector('#agentOfficeInput').files[0],result=await window.RoomOffice[method](await file.arrayBuffer());if(kind==='docsuite')result.html=window.RoomSuiteOfficeBridge.sanitize(result.html);return result;},{method:info.read,kind});});
  const state=make(kind,args.title||path.basename(source,path.extname(source)).slice(0,160)||'Imported file');
  if(kind==='docsuite')state.html=imported.html;
  if(kind==='gridsuite'){const sheet=imported.sheets[0];Object.assign(state,{rows:sheet.rows,columns:sheet.columns,cells:sheet.cells,chart:sheet.chart,types:sheet.types,formats:sheet.formats,styles:sheet.styles,filter:sheet.filter,activeSheetId:sheet.id,sheets:imported.sheets});}
  if(kind==='decksuite')state.slides=imported.slides;
  const result=await save(args.path,null,state,signal);return {...result,warnings:imported.warnings};
}
async function exportOffice(args,signal,kind){
  const info=officeInfo[kind],saved=await read(args.path,signal,kind),out=await outputPath(args.output,[info.ext]),route='/'+kind+'/?'+new URLSearchParams({shared_file:args.path});
  return withRoom(route,info.title,signal,async page=>{
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('Saved ·')||document.querySelector('#status')?.classList.contains('error'));
    if(await page.locator('#status').evaluate(node=>node.classList.contains('error')))throw new Error('Could not open the file in '+info.title+'.');
    const latest=await read(args.path,signal,kind);if(latest.revision!==saved.revision)throw new Error('The file changed during export. Try again.');
    const download=page.waitForEvent('download'),warnings=await page.evaluate(async({kind,method,state,ext})=>{const result=kind==='docsuite'?await window.RoomOffice[method](document.querySelector('#docEditor').innerHTML,state.title,state.comments):await window.RoomOffice[method](state);const url=URL.createObjectURL(result.blob),a=document.createElement('a');a.href=url;a.download='roomsuite'+ext;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);return result.warnings;},{kind,method:info.write,state:saved.state,ext:info.ext});
    const output=await saveDownload(await download,out,info.mime);return {...output,room:kind,operation:'export_'+info.ext.slice(1),revision:saved.revision,warnings};
  });
}
export const docImportDocx=(args,signal)=>importOffice(args,signal,'docsuite');
export const docExportDocx=(args,signal)=>exportOffice(args,signal,'docsuite');
export const gridImportXlsx=(args,signal)=>importOffice(args,signal,'gridsuite');
export const gridExportXlsx=(args,signal)=>exportOffice(args,signal,'gridsuite');
export const deckImportPptx=(args,signal)=>importOffice(args,signal,'decksuite');
export const deckExportPptx=(args,signal)=>exportOffice(args,signal,'decksuite');
