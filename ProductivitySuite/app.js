'use strict';
(() => {
  const $=id=>document.getElementById(id), kind=location.pathname.split('/')[1].toLowerCase();
  const labels={docsuite:['DocSuite','DOCUMENTS','doc'],gridsuite:['GridSuite','SPREADSHEETS','grid'],decksuite:['DeckSuite','PRESENTATIONS','deck'],plansuite:['PlanSuite','CALENDAR','plan']};
  if(!labels[kind])return;
  const [name,label,section]=labels[kind],extension=ProductivityModel.extensions[kind];
  const officeExt={docsuite:'.docx',gridsuite:'.xlsx',decksuite:'.pptx'}[kind];
  let state=ProductivityModel.empty(kind,()=>crypto.randomUUID()),filePath=null,revision=null,dirty=false,saving=false,importing=false,editVersion=0;
  let selectedCell='A1',selectedSlide=0,selectedDay=new Date(),month=new Date(selectedDay.getFullYear(),selectedDay.getMonth(),1),editingEvent=null,savedSelection=null;
  document.title=name+' — RoomSuite';$('suiteName').textContent=name;$('suiteLabel').textContent=label;$(section).hidden=false;
  if(officeExt){$('officeImport').hidden=false;$('officeExport').hidden=false;$('officeShared').hidden=false;$('officeImport').textContent='Import '+officeExt;$('officeExport').textContent='Export '+officeExt;$('officeShared').textContent=officeExt+' to shared';$('officeInput').accept=officeExt;}
  function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
  function changed(){editVersion++;dirty=true;status(filePath?'Unsaved changes · '+filePath:'Unsaved');}
  function hasChanges(){return !dirty||confirm('You have unsaved changes. Continue without saving them?');}
  function safeName(value){return (value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').replace(/[ .]+$/,'').slice(0,140)||'Untitled')+extension;}
  function route(path){return '/api/workspace/productivity?'+new URLSearchParams({path});}
  async function getFile(path){return (await RoomShared.request(route(path))).json();}
  async function putFile(path,baseRevision,value){return (await RoomShared.request(route(path),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision,state:value})})).json();}
  function current(){
    state.title=$('title').value.trim()||'Untitled';
    if(kind==='docsuite')state.html=sanitize($('docEditor').innerHTML);
    return ProductivityModel.validate(state,kind);
  }
  async function save(copy=false){
    if(saving)return;let destination=filePath,base=revision;saving=true;$('saveFile').disabled=true;
    try{
      const value=current(),version=editVersion;
      if(copy||!destination){destination=await RoomShared.chooseSavePath(safeName(value.title));if(!destination)return;if(!destination.toLowerCase().endsWith(extension))destination+=extension;base=null;}
      status('Saving…');
      const result=await putFile(destination,base,value);filePath=result.path;revision=result.revision;
      if(editVersion===version){state=result.state;dirty=false;status('Saved · '+filePath);}else{dirty=true;status('Saved an earlier version; newer changes are unsaved · '+filePath);}
    }catch(error){status(error.message,true);}finally{saving=false;$('saveFile').disabled=false;}
  }
  async function open(path){
    try{
      if(kind==='gridsuite'&&path.toLowerCase().endsWith('.csv')){const file=await RoomShared.get(path);await importCsv(file);return;}
      if(officeExt&&path.toLowerCase().endsWith(officeExt)){await importOffice(await RoomShared.get(path,{maxBytes:OfficeZipGuard.MAX_INPUT}));return;}
      const result=await getFile(path);state=ProductivityModel.validate(result.state,kind);filePath=result.path;revision=result.revision;dirty=false;selectedSlide=0;render();status('Saved · '+filePath);
    }catch(error){status(error.message,true);}
  }
  $('newFile').onclick=()=>{if(saving||importing||!hasChanges())return;editVersion++;state=ProductivityModel.empty(kind,()=>crypto.randomUUID());filePath=null;revision=null;dirty=false;selectedSlide=0;render();status('Unsaved');};
  $('openFile').onclick=async()=>{if(saving||importing||!hasChanges())return;try{const accepted=[extension,...(officeExt?[officeExt]:[]),...(kind==='gridsuite'?['.csv']:[])];const path=await RoomShared.choosePath(accepted);if(path)await open(path);}catch(error){status(error.message,true);}};
  $('saveFile').onclick=()=>save();$('saveCopy').onclick=()=>save(true);$('title').addEventListener('input',changed);
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void save();}});
  for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();

  function sanitize(html){
    const parsed=new DOMParser().parseFromString(html,'text/html'),out=document.createElement('div');
    const allowed=new Set(['P','DIV','BR','STRONG','B','EM','I','U','S','STRIKE','UL','OL','LI','H1','H2','H3','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TD','TH','A','IMG','SPAN','FONT','HR']);
    const discard=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','LINK','META','FORM']);
    function clean(node,parent){
      if(node.nodeType===Node.TEXT_NODE){parent.append(document.createTextNode(node.nodeValue));return;}
      if(node.nodeType!==Node.ELEMENT_NODE||discard.has(node.tagName))return;
      if(!allowed.has(node.tagName)){for(const child of node.childNodes)clean(child,parent);return;}
      const item=document.createElement(node.tagName==='FONT'?'span':node.tagName.toLowerCase());
      if(node.tagName==='A'){const href=node.getAttribute('href')||'';try{const u=new URL(href);if(['http:','https:','mailto:'].includes(u.protocol)){item.href=u.href;item.target='_blank';item.rel='noopener noreferrer';}}catch{}}
      if(node.tagName==='IMG'){const src=node.getAttribute('src')||'';if(!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(src)||src.length>3*1024*1024)return;item.src=src;item.alt=(node.getAttribute('alt')||'').slice(0,300);}
      const align=node.style?.textAlign;if(['left','right','center','justify'].includes(align))item.style.textAlign=align;
      const sizes={'1':'x-small','2':'small','3':'medium','4':'large','5':'x-large','6':'xx-large','7':'xxx-large'},fontSize=node.tagName==='FONT'?sizes[node.getAttribute('size')]:node.style?.fontSize;if(Object.values(sizes).includes(fontSize))item.style.fontSize=fontSize;
      const color=node.tagName==='FONT'?node.getAttribute('color'):node.style?.color;if(color&&(/^(#[0-9a-f]{6}|#[0-9a-f]{3})$/i.test(color)||/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(color)))item.style.color=color;
      for(const child of node.childNodes)clean(child,item);parent.append(item);
    }
    for(const child of parsed.body.childNodes)clean(child,out);return out.innerHTML;
  }
  window.RoomSuiteOfficeBridge={sanitize};
  async function importOffice(file){
    if(importing)return;importing=true;const version=editVersion;
    try{
      if(file.size>OfficeZipGuard.MAX_INPUT)throw new Error('Office files must be 20 MB or smaller.');status('Reading '+file.name+'…');const buffer=await file.arrayBuffer();
      const result=kind==='docsuite'?await RoomOffice.readDocx(buffer):kind==='gridsuite'?await RoomOffice.readXlsx(buffer):await RoomOffice.readPptx(buffer);
      if(editVersion!==version)throw new Error('The current work changed during import. Save it and try importing again.');
      if(result.warnings.length&&!confirm(result.warnings.join('\n\n')+'\n\nContinue importing?')){status('Import cancelled.');return;}
      const next=ProductivityModel.empty(kind,()=>crypto.randomUUID());next.title=file.name.replace(/\.(docx|xlsx|pptx)$/i,'').slice(0,160)||'Imported file';
      if(kind==='docsuite')next.html=sanitize(result.html);
      if(kind==='gridsuite'){const sheet=result.sheets[0];Object.assign(next,sheetData(sheet),{activeSheetId:sheet.id,sheets:result.sheets});}
      if(kind==='decksuite')next.slides=result.slides;
      state=ProductivityModel.validate(next,kind);filePath=null;revision=null;selectedCell='A1';selectedSlide=0;render();changed();status('Imported '+file.name+' · save a RoomSuite copy to keep editing.');
    }catch(error){status(error.message,true);}finally{importing=false;}
  }
  if(officeExt){
    $('officeImport').onclick=()=>{if(!saving&&hasChanges())$('officeInput').click();};
    $('officeInput').onchange=event=>{const file=event.target.files[0];event.target.value='';if(file)void importOffice(file);};
    async function exportOffice(shared){try{status('Preparing '+officeExt+'…');const value=current(),result=kind==='docsuite'?await RoomOffice.writeDocx(value.html,value.title):kind==='gridsuite'?await RoomOffice.writeXlsx(value):await RoomOffice.writePptx(value);if(result.warnings.length&&!confirm(result.warnings.join('\n\n')+'\n\nContinue exporting?')){status('Export cancelled.');return;}const filename=(value.title||'RoomSuite').replace(/[\\/:*?"<>|\x00-\x1f]/g,'-')+officeExt;if(shared){const path=await RoomShared.save(result.blob,filename);status(path?'Exported to shared files · '+path:'Export cancelled.');}else{download(result.blob,result.blob.type,filename);status('Exported '+officeExt+'.');}}catch(error){status(error.message,true);}}
    $('officeExport').onclick=()=>exportOffice(false);$('officeShared').onclick=()=>exportOffice(true);
  }
  function rememberSelection(){const sel=window.getSelection();if(sel&&sel.rangeCount&&$('docEditor').contains(sel.anchorNode))savedSelection=sel.getRangeAt(0).cloneRange();}
  function restoreSelection(){const sel=window.getSelection();$('docEditor').focus();if(savedSelection){try{sel.removeAllRanges();sel.addRange(savedSelection);return;}catch{}}const range=document.createRange();range.selectNodeContents($('docEditor'));range.collapse(false);sel.removeAllRanges();sel.addRange(range);}
  function command(command,value){restoreSelection();document.execCommand(command,false,value);rememberSelection();changed();}
  if(kind==='docsuite'){
    document.addEventListener('selectionchange',rememberSelection);
    for(const button of document.querySelectorAll('[data-command]')){button.addEventListener('mousedown',event=>event.preventDefault());button.onclick=()=>command(button.dataset.command);}
    $('docHeading').onchange=()=>command('formatBlock',$('docHeading').value);
    $('docSize').onchange=()=>command('fontSize',$('docSize').value);$('docColor').oninput=()=>command('foreColor',$('docColor').value);
    $('docEditor').addEventListener('input',()=>{changed();wordCount();});
    $('docEditor').addEventListener('paste',event=>{event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));changed();});
    $('docLink').onclick=()=>{const value=prompt('Enter a link beginning with https://, http:// or mailto:');if(!value)return;try{const url=new URL(value);if(!['https:','http:','mailto:'].includes(url.protocol))throw new Error();command('createLink',url.href);}catch{status('Enter a valid web or email link.',true);}};
    $('docTable').onclick=()=>command('insertHTML','<table><tbody><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>');
    $('docImage').onclick=async()=>{try{const data=await sharedImage();if(data)command('insertImage',data);}catch(error){status(error.message,true);}};
    $('docTextImport').onclick=()=>{if(confirm('Replace this document with a text file?'))$('docTextInput').click();};
    $('docTextInput').onchange=async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>1024*1024)throw new Error('Text files must be 1 MB or smaller.');const content=await file.text(),container=document.createElement('div');for(const line of content.split(/\r?\n/)){const p=document.createElement('p');if(line)p.textContent=line;else p.append(document.createElement('br'));container.append(p);}$('docEditor').replaceChildren(...container.childNodes);wordCount();changed();}catch(error){status(error.message,true);}};
    $('docTextExport').onclick=()=>download($('docEditor').innerText,'text/plain;charset=utf-8',($('title').value.trim()||'document')+'.txt');
    $('docPrint').onclick=()=>window.print();
  }
  async function sharedImage(){
    const file=await RoomShared.choose(['.png','.jpg','.jpeg','.webp','.gif']);if(!file)return null;
    if(file.size>2*1024*1024)throw new Error('Choose an image smaller than 2 MB.');
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read this image.'));reader.readAsDataURL(file);});
  }

  function recalculate(){const calculate=GridModel.calculate(state.cells,state.rows,state.columns,state.types);for(const input of document.querySelectorAll('.grid-cell'))if(input!==document.activeElement)input.value=calculate(input.dataset.cell);renderChart();}
  function setCell(address,value){if(value)state.cells[address]=value;else{delete state.cells[address];delete state.formats?.[address];}delete state.types?.[address];changed();recalculate();}
  function sheetData(sheet){return {rows:sheet.rows,columns:sheet.columns,cells:sheet.cells,chart:sheet.chart,types:sheet.types||{},formats:sheet.formats||{}};}
  function selectSheet(sheetId){state.title=$('title').value.trim()||'Untitled';const normalized=ProductivityModel.validate(state,kind),sheet=normalized.sheets.find(item=>item.id===sheetId);if(!sheet)throw new Error('Sheet not found.');state={...normalized,...sheetData(sheet),activeSheetId:sheet.id};selectedCell='A1';renderGrid();changed();}
  function renderSheetTabs(){const tabs=$('sheetTabs');tabs.replaceChildren();for(const sheet of state.sheets||[]){const button=document.createElement('button');button.type='button';button.className='sheet-tab'+(sheet.id===state.activeSheetId?' active':'');button.textContent=sheet.name;button.setAttribute('aria-pressed',String(sheet.id===state.activeSheetId));button.onclick=()=>{if(sheet.id!==state.activeSheetId)try{selectSheet(sheet.id);}catch(error){status(error.message,true);}};tabs.append(button);}}
  function renderChart(){
    const root=$('chartDisplay');root.replaceChildren();root.hidden=!state.chart;if(!state.chart)return;
    try{
      const calc=GridModel.calculate(state.cells,state.rows,state.columns,state.types),labels=GridModel.range(state.chart.labels,state.rows,state.columns).map(calc),raw=GridModel.range(state.chart.values,state.rows,state.columns).map(calc);
      if(raw.some(value=>value===''||!Number.isFinite(Number(value))))throw new Error('The value range must contain numbers.');
      const values=raw.map(Number),min=Math.min(0,...values),max=Math.max(0,...values),span=max-min||1,width=Math.max(500,values.length*50+100),height=340,left=48,right=width-20,top=20,bottom=260,step=(right-left)/values.length,y=value=>bottom-(value-min)/span*(bottom-top),zero=y(0);
      const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',(state.chart.type==='bar'?'Bar':'Line')+' chart of '+state.chart.values);
      function element(tag,attributes,text){const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;svg.append(node);return node;}
      element('line',{x1:left,y1:zero,x2:right,y2:zero,stroke:'#b9b2c7','stroke-width':1});
      element('text',{x:4,y:top+5,fill:'#777384','font-size':11},String(Number(max.toPrecision(5))));element('text',{x:4,y:bottom,fill:'#777384','font-size':11},String(Number(min.toPrecision(5))));
      const points=[];values.forEach((value,index)=>{const x=left+step*(index+.5),position=y(value);points.push([x,position]);if(state.chart.type==='bar')element('rect',{x:x-step*.3,y:Math.min(position,zero),width:step*.6,height:Math.max(1,Math.abs(zero-position)),rx:3,fill:'#8d78e8'});element('text',{x,y:bottom+18,'text-anchor':'middle',fill:'#716b80','font-size':11},String(labels[index]||'').slice(0,12));});
      if(state.chart.type==='line'){element('polyline',{points:points.map(point=>point.join(',')).join(' '),fill:'none',stroke:'#785ee8','stroke-width':3});for(const [x,position] of points)element('circle',{cx:x,cy:position,r:4,fill:'#785ee8'});}
      const heading=document.createElement('h3');heading.textContent=state.chart.type==='bar'?'Bar chart':'Line chart';const description=document.createElement('p');description.className='hint';description.textContent=state.chart.labels+' labels · '+state.chart.values+' values';root.append(heading,description,svg);
    }catch(error){const message=document.createElement('p');message.className='hint';message.textContent='Chart: '+error.message;root.append(message);}
  }
  function renderGrid(){
    const table=$('gridTable');table.replaceChildren();const head=document.createElement('thead'),header=document.createElement('tr'),corner=document.createElement('th');corner.textContent='#';header.append(corner);
    for(let col=0;col<state.columns;col++){const th=document.createElement('th');th.scope='col';th.textContent=GridModel.column(col);header.append(th);}head.append(header);table.append(head);
    const body=document.createElement('tbody'),calculate=GridModel.calculate(state.cells,state.rows,state.columns,state.types);
    for(let row=1;row<=state.rows;row++){const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';th.textContent=String(row);tr.append(th);
      for(let col=0;col<state.columns;col++){const address=GridModel.column(col)+row,td=document.createElement('td'),input=document.createElement('input');input.className='grid-cell';input.dataset.cell=address;input.setAttribute('aria-label','Cell '+address);input.value=calculate(address);input.maxLength=5000;
        input.addEventListener('focus',()=>{selectedCell=address;$('cellAddress').textContent=address;input.value=state.cells[address]||'';$('formula').value=input.value;});
        input.addEventListener('input',()=>{if(input.value)state.cells[address]=input.value;else{delete state.cells[address];delete state.formats?.[address];}delete state.types?.[address];$('formula').value=input.value;changed();});
        input.addEventListener('blur',()=>recalculate());
        input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();const next=table.querySelector('[data-cell="'+GridModel.column(col)+Math.min(row+1,state.rows)+'"]');next?.focus();}});
        td.append(input);tr.append(td);
      }body.append(tr);
    }table.append(body);$('cellAddress').textContent=selectedCell;$('formula').value=state.cells[selectedCell]||'';renderSheetTabs();renderChart();
  }
  async function importCsv(file){
    try{if(file.size>2*1024*1024)throw new Error('CSV files must be 2 MB or smaller.');const rows=GridModel.parseCsv(await file.text());if(rows.length>500||rows.some(row=>row.length>52||row.some(value=>value.length>5000)))throw new Error('CSV exceeds 500 rows, 52 columns or 5000 characters per cell.');
      state=ProductivityModel.empty(kind,()=>crypto.randomUUID());state.rows=Math.max(100,rows.length);state.columns=Math.max(26,...rows.map(row=>row.length));state.title=file.name.replace(/\.csv$/i,'')||'Imported spreadsheet';
      rows.forEach((row,r)=>row.forEach((value,c)=>{if(value)state.cells[GridModel.column(c)+(r+1)]=value;}));filePath=null;revision=null;selectedCell='A1';render();changed();status('CSV imported · save as a GridSuite file to keep editing.');
    }catch(error){status(error.message,true);}
  }
  if(kind==='gridsuite'){
    $('applyFormula').onclick=()=>{setCell(selectedCell,$('formula').value);const input=document.querySelector('[data-cell="'+selectedCell+'"]');if(input)input.value=GridModel.calculate(state.cells,state.rows,state.columns,state.types)(selectedCell);};
    $('formula').onkeydown=event=>{if(event.key==='Enter'){$('applyFormula').click();event.preventDefault();}};
    function sortGrid(descending){try{const col=GridModel.column(GridModel.address(selectedCell).col);if(!confirm('Sort rows by column '+col+'? Row 1 stays in place.'))return;if(Object.keys(state.types||{}).length||Object.keys(state.formats||{}).length)throw new Error('Sorting imported cell formats is not supported yet.');state.cells=GridModel.sortRows(state.cells,col,descending);renderGrid();changed();}catch(error){status(error.message,true);}}
    $('sortAsc').onclick=()=>sortGrid(false);$('sortDesc').onclick=()=>sortGrid(true);
    $('addSheet').onclick=()=>{try{if(state.sheets.length>=20)throw new Error('A workbook supports up to 20 sheets.');let n=state.sheets.length+1;while(state.sheets.some(sheet=>sheet.name.toLowerCase()===('sheet '+n).toLowerCase()))n++;const sheet={id:crypto.randomUUID(),name:'Sheet '+n,rows:100,columns:26,cells:{},chart:null,types:{},formats:{}};state.sheets.push(sheet);selectSheet(sheet.id);}catch(error){status(error.message,true);}};
    $('renameSheet').onclick=()=>{const current=state.sheets.find(sheet=>sheet.id===state.activeSheetId),name=prompt('Sheet name',current.name);if(name===null)return;try{const previous=current.name;current.name=name.trim();try{state=ProductivityModel.validate({...state,title:$('title').value.trim()||'Untitled'},kind);}catch(error){current.name=previous;throw error;}renderSheetTabs();changed();}catch(error){status(error.message,true);}};
    $('deleteSheet').onclick=()=>{try{if(state.sheets.length===1)throw new Error('A workbook needs at least one sheet.');const current=state.sheets.find(sheet=>sheet.id===state.activeSheetId);if(!confirm('Delete sheet “'+current.name+'” and its cells?'))return;const normalized=ProductivityModel.validate({...state,title:$('title').value.trim()||'Untitled'},kind),sheets=normalized.sheets.filter(sheet=>sheet.id!==state.activeSheetId),next=sheets[0];state={...normalized,...sheetData(next),sheets,activeSheetId:next.id};selectedCell='A1';renderGrid();changed();}catch(error){status(error.message,true);}};
    $('addRows').onclick=()=>{if(state.rows>=500){status('A spreadsheet supports up to 500 rows.',true);return;}state.rows=Math.min(500,state.rows+50);renderGrid();changed();};
    $('addColumns').onclick=()=>{if(state.columns>=52){status('A spreadsheet supports up to 52 columns.',true);return;}state.columns=Math.min(52,state.columns+13);renderGrid();changed();};
    $('gridChart').onclick=()=>{$('chartType').value=state.chart?.type||'bar';$('chartLabels').value=state.chart?.labels||'';$('chartValues').value=state.chart?.values||'';$('removeChart').hidden=!state.chart;$('chartError').textContent='';$('chartDialog').showModal();};
    $('chartForm').onsubmit=event=>{event.preventDefault();try{state=ProductivityModel.validate({...state,chart:{type:$('chartType').value,labels:$('chartLabels').value.trim().toUpperCase(),values:$('chartValues').value.trim().toUpperCase()}},kind);$('chartDialog').close();renderChart();changed();}catch(error){$('chartError').textContent=error.message;}};
    $('removeChart').onclick=()=>{state.chart=null;$('chartDialog').close();renderChart();changed();};
    $('csvOpen').onclick=()=>{if(hasChanges())$('csvInput').click();};$('csvInput').onchange=event=>{const file=event.target.files[0];event.target.value='';if(file)void importCsv(file);};
    $('csvShared').onclick=async()=>{if(!hasChanges())return;try{const file=await RoomShared.choose(['.csv']);if(file)await importCsv(file);}catch(error){status(error.message,true);}};
    $('csvExport').onclick=()=>{const entries=Object.keys(state.cells).map(GridModel.address);let maxRow=0,maxCol=0;for(const entry of entries){maxRow=Math.max(maxRow,entry.row);maxCol=Math.max(maxCol,entry.col);}const rows=[];for(let r=0;r<=maxRow;r++){const row=[];for(let c=0;c<=maxCol;c++)row.push(state.cells[GridModel.column(c)+(r+1)]||'');rows.push(row);}download(GridModel.toCsv(rows),'text/csv;charset=utf-8',($('title').value.trim()||'spreadsheet')+'.csv');};
  }
  function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

  function slideList(){const list=$('slideList');list.replaceChildren();state.slides.forEach((slide,index)=>{const button=document.createElement('button');button.className='slide-item'+(index===selectedSlide?' active':'');button.textContent=(index+1)+'  '+(slide.title||'Untitled slide');button.onclick=()=>{selectedSlide=index;renderDeck();};list.append(button);});}
  function renderDeck(){const slide=state.slides[selectedSlide];slideList();$('slideTitle').value=slide.title;$('slideBody').value=slide.body;$('slideColor').value=slide.background;$('slideCanvas').style.background=slide.background;$('slidePreview').hidden=!slide.image;if(slide.image)$('slidePreview').src=slide.image;else $('slidePreview').removeAttribute('src');}
  function presentSlide(){const slide=state.slides[selectedSlide],root=$('presentSlide');root.replaceChildren();root.style.background=slide.background;const title=document.createElement('h2'),body=document.createElement('p');title.textContent=slide.title;body.textContent=slide.body;root.append(title,body);if(slide.image){const img=document.createElement('img');img.src=slide.image;img.alt='';root.append(img);}$('presentCount').textContent=(selectedSlide+1)+' / '+state.slides.length;}
  if(kind==='decksuite'){
    $('slideTitle').oninput=event=>{state.slides[selectedSlide].title=event.target.value;slideList();changed();};$('slideBody').oninput=event=>{state.slides[selectedSlide].body=event.target.value;changed();};
    $('slideColor').oninput=event=>{state.slides[selectedSlide].background=event.target.value;$('slideCanvas').style.background=event.target.value;changed();};
    $('addSlide').onclick=()=>{if(state.slides.length>=100){status('A deck can have up to 100 slides.',true);return;}state.slides.splice(selectedSlide+1,0,{id:crypto.randomUUID(),title:'New slide',body:'',image:'',background:'#ffffff'});selectedSlide++;renderDeck();changed();};
    $('duplicateSlide').onclick=()=>{if(state.slides.length>=100)return;state.slides.splice(selectedSlide+1,0,{...state.slides[selectedSlide],id:crypto.randomUUID()});selectedSlide++;renderDeck();changed();};
    $('deleteSlide').onclick=()=>{if(state.slides.length===1){status('A presentation needs at least one slide.',true);return;}if(!confirm('Delete this slide?'))return;state.slides.splice(selectedSlide,1);selectedSlide=Math.min(selectedSlide,state.slides.length-1);renderDeck();changed();};
    function moveSlide(delta){const next=selectedSlide+delta;if(next<0||next>=state.slides.length)return;[state.slides[selectedSlide],state.slides[next]]=[state.slides[next],state.slides[selectedSlide]];selectedSlide=next;renderDeck();changed();}
    $('slideUp').onclick=()=>moveSlide(-1);$('slideDown').onclick=()=>moveSlide(1);
    $('slideImage').onclick=async()=>{try{const image=await sharedImage();if(image){state.slides[selectedSlide].image=image;renderDeck();changed();}}catch(error){status(error.message,true);}};
    $('removeSlideImage').onclick=()=>{state.slides[selectedSlide].image='';renderDeck();changed();};
    $('present').onclick=()=>{presentSlide();$('presentDialog').showModal();};$('presentPrev').onclick=()=>{selectedSlide=Math.max(0,selectedSlide-1);presentSlide();renderDeck();};$('presentNext').onclick=()=>{selectedSlide=Math.min(state.slides.length-1,selectedSlide+1);presentSlide();renderDeck();};
    $('presentDialog').addEventListener('keydown',event=>{if(event.key==='ArrowLeft')$('presentPrev').click();if(event.key==='ArrowRight')$('presentNext').click();});
    $('deckPrint').onclick=()=>{const old=document.querySelector('.print-slides');old?.remove();const root=document.createElement('div');root.className='print-slides';for(const slide of state.slides){const page=document.createElement('div');page.className='print-slide';page.style.background=slide.background;const title=document.createElement('h2'),body=document.createElement('p');title.textContent=slide.title;body.textContent=slide.body;page.append(title,body);if(slide.image){const img=document.createElement('img');img.src=slide.image;img.alt='';page.append(img);}root.append(page);}document.body.append(root);window.print();};
  }

  const pad=n=>String(n).padStart(2,'0');
  const dayKey=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const localInput=d=>dayKey(d)+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  const eventsForDay=day=>{const from=new Date(day.getFullYear(),day.getMonth(),day.getDate()).getTime(),to=new Date(day.getFullYear(),day.getMonth(),day.getDate()+1).getTime();return state.events.filter(event=>Date.parse(event.start)<to&&Date.parse(event.end)>from).sort((a,b)=>a.start.localeCompare(b.start));};
  function renderCalendar(){
    $('monthTitle').textContent=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});$('agendaTitle').textContent=selectedDay.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
    const root=$('calendarGrid');root.replaceChildren();const first=new Date(month.getFullYear(),month.getMonth(),1),offset=(first.getDay()+6)%7,start=new Date(month.getFullYear(),month.getMonth(),1-offset);
    for(let i=0;i<42;i++){const day=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i),button=document.createElement('button');button.className='day'+(day.getMonth()!==month.getMonth()?' outside':'')+(dayKey(day)===dayKey(selectedDay)?' selected':'')+(dayKey(day)===dayKey(new Date())?' today':'');button.setAttribute('aria-label',day.toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'}));const number=document.createElement('span');number.className='day-number';number.textContent=day.getDate();button.append(number);const events=eventsForDay(day);for(const event of events.slice(0,2)){const item=document.createElement('span');item.className='day-event';item.textContent=event.title;button.append(item);}if(events.length>2){const more=document.createElement('span');more.className='day-event';more.textContent='+'+(events.length-2)+' more';button.append(more);}button.onclick=()=>{selectedDay=day;month=new Date(day.getFullYear(),day.getMonth(),1);renderCalendar();};root.append(button);}
    const agenda=$('agendaList');agenda.replaceChildren();const events=eventsForDay(selectedDay);if(!events.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='No events for this day.';agenda.append(empty);}
    for(const event of events){const button=document.createElement('button');button.className='agenda-event';const title=document.createElement('strong'),time=document.createElement('small'),start=new Date(event.start),end=new Date(event.end);title.textContent=event.title;const format=value=>dayKey(value)===dayKey(selectedDay)?value.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):value.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});time.textContent=format(start)+' – '+format(end);button.append(title,time);button.onclick=()=>eventDialog(event);agenda.append(button);}
  }
  function eventDialog(event){
    editingEvent=event?.id||null;$('eventHeading').textContent=event?'Edit event':'New event';$('eventTitle').value=event?.title||'';$('eventDescription').value=event?.description||'';
    const start=event?new Date(event.start):new Date(selectedDay.getFullYear(),selectedDay.getMonth(),selectedDay.getDate(),9,0),end=event?new Date(event.end):new Date(start.getTime()+3600000);
    $('eventStart').value=localInput(start);$('eventEnd').value=localInput(end);$('repeatOptions').hidden=!!event;$('eventRepeat').value='none';$('eventRepeatCount').value='4';$('eventRepeatCount').disabled=true;const reminder=event?.remindMinutes;const select=$('eventReminder');for(const option of [...select.querySelectorAll('[data-custom]')])option.remove();if(reminder!==null&&reminder!==undefined&&![...select.options].some(option=>option.value===String(reminder))){const option=new Option(reminder+' minutes before',String(reminder));option.dataset.custom='true';select.add(option);}select.value=reminder===null||reminder===undefined?'':String(reminder);$('deleteEvent').hidden=!event;$('eventError').textContent='';$('eventDialog').showModal();
  }
  if(kind==='plansuite'){
    document.querySelectorAll('.weekdays span').forEach((span,index)=>{span.textContent=new Date(2024,0,1+index).toLocaleDateString(undefined,{weekday:'short'});});
    $('calendarExport').onclick=()=>download(CalendarModel.ics(state.events),'text/calendar;charset=utf-8',($('title').value.trim()||'calendar')+'.ics');
    $('previousMonth').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);selectedDay=new Date(month);renderCalendar();};$('nextMonth').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);selectedDay=new Date(month);renderCalendar();};$('today').onclick=()=>{selectedDay=new Date();month=new Date(selectedDay.getFullYear(),selectedDay.getMonth(),1);renderCalendar();};$('newEvent').onclick=()=>eventDialog();
    $('eventRepeat').onchange=()=>{$('eventRepeatCount').disabled=$('eventRepeat').value==='none';};
    $('eventForm').onsubmit=event=>{event.preventDefault();try{const start=new Date($('eventStart').value),end=new Date($('eventEnd').value);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)throw new Error('Choose an end time after the start time.');const item={id:editingEvent||crypto.randomUUID(),title:$('eventTitle').value.trim(),start:start.toISOString(),end:end.toISOString(),description:$('eventDescription').value,remindMinutes:$('eventReminder').value===''?null:Number($('eventReminder').value)};const index=state.events.findIndex(value=>value.id===editingEvent);const events=[...state.events];if(index<0){events.push(item);const repeat=$('eventRepeat').value,count=repeat==='none'?1:Number($('eventRepeatCount').value);if(!Number.isInteger(count)||count<1||count>52||(repeat!=='none'&&count<2))throw new Error('Choose 2 to 52 events.');for(let i=1;i<count;i++){const next=new Date(start);if(repeat==='monthly'){next.setDate(1);next.setMonth(start.getMonth()+i);const last=new Date(next.getFullYear(),next.getMonth()+1,0).getDate();next.setDate(Math.min(start.getDate(),last));}else next.setDate(start.getDate()+i*(repeat==='weekly'?7:1));events.push({...item,id:crypto.randomUUID(),start:next.toISOString(),end:new Date(next.getTime()+end.getTime()-start.getTime()).toISOString()});}}else events[index]=item;state=ProductivityModel.validate({...state,events},kind);selectedDay=start;month=new Date(start.getFullYear(),start.getMonth(),1);$('eventDialog').close();renderCalendar();changed();}catch(error){$('eventError').textContent=error.message;}};
    $('deleteEvent').onclick=()=>{if(!editingEvent||!confirm('Delete this event?'))return;state.events=state.events.filter(event=>event.id!==editingEvent);$('eventDialog').close();renderCalendar();changed();};
    $('notificationSettings').onclick=async()=>{try{const data=await (await RoomShared.request('/api/workspace/notifications')).json();$('ntfyEnabled').checked=data.enabled;$('ntfyServer').value=data.server;$('ntfyTopic').value=data.topic;$('ntfyToken').value='';$('ntfyToken').placeholder=data.hasToken?'A token is saved; leave blank to keep it':'Optional access token';$('ntfyClearToken').checked=false;$('ntfyStatus').textContent=data.lastError||'';$('ntfyDialog').showModal();}catch(error){status(error.message,true);}};
    $('ntfyForm').onsubmit=async event=>{event.preventDefault();try{const data={enabled:$('ntfyEnabled').checked,server:$('ntfyServer').value,topic:$('ntfyTopic').value};if($('ntfyClearToken').checked)data.token='';else if($('ntfyToken').value)data.token=$('ntfyToken').value;await RoomShared.request('/api/workspace/notifications',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});$('ntfyToken').value='';$('ntfyClearToken').checked=false;$('ntfyStatus').textContent='Settings saved.';}catch(error){$('ntfyStatus').textContent=error.message;}};
    $('ntfyTest').onclick=async()=>{try{$('ntfyStatus').textContent='Sending test…';await RoomShared.request('/api/workspace/notifications/test',{method:'POST'});$('ntfyStatus').textContent='Test sent. Check your subscribed device.';}catch(error){$('ntfyStatus').textContent=error.message;}};
  }
  function wordCount(){const value=$('docEditor').innerText.trim(),count=value?value.split(/\s+/).length:0;$('docWords').textContent=count+' word'+(count===1?'':'s');}
  function render(){$('title').value=state.title;if(kind==='docsuite'){$('docEditor').innerHTML=sanitize(state.html);wordCount();}if(kind==='gridsuite')renderGrid();if(kind==='decksuite')renderDeck();if(kind==='plansuite')renderCalendar();}
  render();const query=new URLSearchParams(location.search),path=query.get('shared_file');if(path){query.delete('shared_file');history.replaceState(null,'',location.pathname+(query.toString()?'?'+query:''));void open(path);}
})();
