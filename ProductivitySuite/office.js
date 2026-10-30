'use strict';
(() => {
  const loaded=new Map(),base='/'+location.pathname.split('/')[1]+'/vendor/';
  function library(name,global){if(loaded.has(name))return loaded.get(name);if(name!=='jszip'&&window[global])return Promise.resolve(window[global]);loaded.set(name,new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=base+name+'.js';script.onload=()=>window[global]?resolve(window[global]):reject(new Error('Office conversion library did not load.'));script.onerror=()=>reject(new Error('Could not load the offline Office conversion library.'));document.head.append(script);}));return loaded.get(name);}
  const unique=messages=>[...new Set(messages.filter(Boolean))];
  async function archive(buffer,required){
    const manifest=OfficeZipGuard.inspect(buffer),fflate=await library('fflate','fflate');OfficeZipGuard.verify(buffer,manifest,fflate);const JSZip=await library('jszip','JSZip');let zip;
    try{zip=await JSZip.loadAsync(buffer);}catch{throw new Error('This Office file is damaged or unsupported.');}
    for(const name of required)if(!zip.file(name))throw new Error('This is not the expected Office file type.');return zip;
  }
  function dataUrl(bytes,type){let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return 'data:'+type+';base64,'+btoa(value);}
  async function pngOrJpeg(source){
    if(/^data:image\/(png|jpeg);base64,/i.test(source))return source;
    const image=new Image();image.src=source;await image.decode();if(image.naturalWidth*image.naturalHeight>16000000)throw new Error('An image is too large to convert.');
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png');
  }
  async function readDocx(buffer){
    await archive(buffer,['[Content_Types].xml','word/document.xml']);const mammoth=await library('mammoth','mammoth'),warnings=['Word imports retain supported text, lists, tables, links and images. Complex layout, comments and other features may be simplified.'];
    let result;try{result=await mammoth.convertToHtml({arrayBuffer:buffer},{includeEmbeddedStyleMap:false,externalFileAccess:false,convertImage:mammoth.images.imgElement(async image=>{const type=image.contentType.toLowerCase();if(!['image/png','image/jpeg','image/gif','image/webp'].includes(type)){warnings.push('An unsupported image was omitted.');return {src:''};}const bytes=new Uint8Array(await image.readAsArrayBuffer());if(bytes.length>2*1024*1024)throw new Error('A Word image exceeds the 2 MB image limit.');return {src:dataUrl(bytes,type)};})});}catch(error){throw new Error('Could not import this Word document: '+error.message);}
    warnings.push(...result.messages.map(message=>message.message));return {html:result.value,warnings:unique(warnings)};
  }
  async function writeDocx(html,title){
    const D=await library('docx','docx'),parsed=new DOMParser().parseFromString(html,'text/html');
    const sizeMap={'x-small':16,small:18,medium:22,large:28,'x-large':36,'xx-large':48,'xxx-large':56};
    async function inline(node,style={}){
      if(node.nodeType===Node.TEXT_NODE)return node.nodeValue?[new D.TextRun({...style,text:node.nodeValue})]:[];
      if(node.nodeType!==Node.ELEMENT_NODE)return [];
      if(node.tagName==='BR')return [new D.TextRun({break:1})];
      if(node.tagName==='IMG'){
        const source=await pngOrJpeg(node.getAttribute('src')||''),image=new Image();image.src=source;await image.decode();const scale=Math.min(1,600/image.naturalWidth,700/image.naturalHeight),raw=atob(source.split(',')[1]),bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));
        return [new D.ImageRun({data:bytes,type:source.startsWith('data:image/jpeg')?'jpg':'png',transformation:{width:Math.max(1,Math.round(image.naturalWidth*scale)),height:Math.max(1,Math.round(image.naturalHeight*scale))}})];
      }
      const next={...style};if(['B','STRONG'].includes(node.tagName))next.bold=true;if(['I','EM'].includes(node.tagName))next.italics=true;if(node.tagName==='U')next.underline={};if(['S','STRIKE'].includes(node.tagName))next.strike=true;
      if(node.style?.fontSize&&sizeMap[node.style.fontSize])next.size=sizeMap[node.style.fontSize];
      if(node.style?.color){const match=/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(node.style.color);if(match)next.color=match.slice(1).map(value=>Number(value).toString(16).padStart(2,'0')).join('').toUpperCase();}
      const children=[];for(const child of node.childNodes)children.push(...await inline(child,next));
      if(node.tagName==='A'&&/^https?:|^mailto:/i.test(node.getAttribute('href')||''))return [new D.ExternalHyperlink({link:node.getAttribute('href'),children})];
      return children;
    }
    async function paragraph(node,options={}){const children=[];for(const child of node.childNodes)children.push(...await inline(child));const align={left:D.AlignmentType.LEFT,center:D.AlignmentType.CENTER,right:D.AlignmentType.RIGHT,justify:D.AlignmentType.JUSTIFIED}[node.style?.textAlign];return new D.Paragraph({...options,...(align?{alignment:align}:{}),children});}
    async function blocks(parent){const result=[];for(const node of parent.childNodes){
      if(node.nodeType===Node.TEXT_NODE){if(node.nodeValue.trim())result.push(new D.Paragraph({children:await inline(node)}));continue;}if(node.nodeType!==Node.ELEMENT_NODE)continue;
      if(['UL','OL'].includes(node.tagName)){for(const item of node.children)if(item.tagName==='LI')result.push(await paragraph(item,node.tagName==='UL'?{bullet:{level:0}}:{numbering:{reference:'numbered',level:0}}));continue;}
      if(node.tagName==='TABLE'){const rows=[];for(const row of node.querySelectorAll('tr')){const cells=[];for(const cell of row.children)if(['TD','TH'].includes(cell.tagName))cells.push(new D.TableCell({children:[await paragraph(cell)]}));if(cells.length)rows.push(new D.TableRow({children:cells}));}if(rows.length)result.push(new D.Table({rows,width:{size:100,type:D.WidthType.PERCENTAGE}}));continue;}
      if(node.tagName==='DIV'&&[...node.children].some(child=>['P','DIV','H1','H2','H3','TABLE','UL','OL'].includes(child.tagName))){result.push(...await blocks(node));continue;}
      const heading={H1:D.HeadingLevel.HEADING_1,H2:D.HeadingLevel.HEADING_2,H3:D.HeadingLevel.HEADING_3}[node.tagName];result.push(await paragraph(node,heading?{heading}:{}));
    }return result;}
    const children=await blocks(parsed.body);if(!children.length)children.push(new D.Paragraph(''));
    const doc=new D.Document({title,numbering:{config:[{reference:'numbered',levels:[{level:0,format:'decimal',text:'%1.',alignment:'left',style:{paragraph:{indent:{left:720,hanging:360}}}}]}]},sections:[{children}]});
    return {blob:await D.Packer.toBlob(doc),warnings:[]};
  }
  async function readXlsx(buffer){
    const zip=await archive(buffer,['[Content_Types].xml','xl/workbook.xml']);const Excel=await library('exceljs','ExcelJS'),workbook=new Excel.Workbook(),warnings=['Excel imports retain sheet names, values, formulas, dates and number formats. Other formatting, charts and workbook features may be simplified.'];
    // ExcelJS expects spreadsheet elements without an explicit namespace prefix.
    // Normalize a temporary in-memory copy so valid prefixed OOXML is readable.
    let normalized=false;for(const name of Object.keys(zip.files).filter(name=>/^xl\/.*\.xml$/i.test(name))){const entry=zip.file(name);if(!entry)continue;let content=await entry.async('string');if(/<!DOCTYPE/i.test(content))throw new Error('Office XML with a document type is not supported.');const prefixes=[...content.matchAll(/xmlns:([A-Za-z_][\w.-]*)=["'](?:http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main|http:\/\/purl\.oclc\.org\/ooxml\/spreadsheetml\/main)["']/g)].map(match=>match[1]);for(const prefix of new Set(prefixes)){const escaped=prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),next=content.replace(new RegExp('(<\\/?)'+escaped+':','g'),'$1');if(next!==content){content=next;normalized=true;zip.file(name,content);}}}
    const source=normalized?await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}):buffer;
    try{await workbook.xlsx.load(source);}catch(error){throw new Error('Could not import this Excel workbook: '+error.message);}
    if(!workbook.worksheets.length||workbook.worksheets.length>20)throw new Error('GridSuite supports 1 to 20 sheets.');
    if(Object.keys(zip.files).some(name=>/^xl\/(charts|drawings|pivotTables|externalLinks)\//i.test(name)))warnings.push('Charts, drawings, pivot tables or external links are not imported.');
    const sheets=[];for(const worksheet of workbook.worksheets){const cells={},types={},formats={};let maxRow=0,maxCol=0;if(worksheet.state!=='visible')warnings.push('Hidden worksheets become visible in GridSuite.');if(worksheet.model?.merges?.length)warnings.push('Merged cells are imported as separate cells; review their layout.');
      worksheet.eachRow({includeEmpty:false},(row,rowNumber)=>{row.eachCell({includeEmpty:false},(cell,colNumber)=>{
        if(rowNumber>500||colNumber>52)throw new Error('A worksheet exceeds 500 rows or 52 columns.');const address=GridModel.column(colNumber-1)+rowNumber,value=cell.value;let content='';
        if(cell.formula){content='='+cell.formula;warnings.push('Some Excel formulas may not calculate in GridSuite; formulas are kept for export.');}
        else if(value instanceof Date){content=value.toISOString();types[address]='date';}
        else if(typeof value==='number')content=String(value);
        else if(typeof value==='boolean'){content=value?'TRUE':'FALSE';types[address]='boolean';}
        else if(typeof value==='string'){content=value;types[address]='text';}
        else if(value&&typeof value==='object'&&value.error){content=String(value.error);types[address]='error';}
        else if(value&&typeof value==='object'&&Array.isArray(value.richText)){content=value.richText.map(part=>part.text||'').join('');types[address]='text';warnings.push('Rich cell text is imported as plain text.');}
        else if(value&&typeof value==='object'&&typeof value.text==='string'){content=value.text;types[address]='text';warnings.push('Cell hyperlinks are imported as text.');}
        else if(value!==null&&value!==undefined)throw new Error('A worksheet contains an unsupported cell value.');
        if(content.length>5000)throw new Error('A cell exceeds the 5000-character limit.');if(content){cells[address]=content;if(cell.numFmt&&cell.numFmt!=='General')formats[address]=cell.numFmt;}maxRow=Math.max(maxRow,rowNumber);maxCol=Math.max(maxCol,colNumber);
      });});
      sheets.push({id:crypto.randomUUID(),name:worksheet.name,rows:Math.max(100,maxRow),columns:Math.max(26,maxCol),cells,chart:null,types,formats});
    }
    return {sheets,warnings:unique(warnings)};
  }
  async function writeXlsx(state){
    const Excel=await library('exceljs','ExcelJS'),workbook=new Excel.Workbook(),normalized=ProductivityModel.validate(state,'gridsuite'),warnings=[];workbook.creator='RoomSuite';workbook.title=state.title;workbook.calcProperties.fullCalcOnLoad=true;
    for(const sheet of normalized.sheets){const worksheet=workbook.addWorksheet(sheet.name),calculate=GridModel.calculate(sheet.cells,sheet.rows,sheet.columns,sheet.types);if(sheet.chart)warnings.push('GridSuite charts are not included in Excel exports.');
      for(const [address,raw] of Object.entries(sheet.cells)){const cell=worksheet.getCell(address),type=sheet.types[address];
        if(raw.startsWith('=')&&type!=='text'){const value=calculate(address),result=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)?Number(value):value==='TRUE'?true:value==='FALSE'?false:value.startsWith('#')?undefined:value;cell.value={formula:raw.slice(1),...(result===undefined?{}:{result})};}
        else if(type==='date'){const date=new Date(raw);if(Number.isNaN(date.getTime()))throw new Error('An imported date is invalid.');cell.value=date;}
        else if(type==='boolean')cell.value=raw==='TRUE';else if(type==='error')cell.value={error:raw};else if(type==='text')cell.value=raw;else if(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()))cell.value=Number(raw);else cell.value=raw;
        if(sheet.formats[address])cell.numFmt=sheet.formats[address];
      }
    }
    const bytes=await workbook.xlsx.writeBuffer();return {blob:new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),warnings:unique(warnings)};
  }
  function xml(value){if(/<!DOCTYPE/i.test(value))throw new Error('Office XML with a document type is not supported.');const doc=new DOMParser().parseFromString(value,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw new Error('An Office XML part is invalid.');return doc;}
  function relationPath(source,target){if(!target||/^[a-z]+:/i.test(target))return null;try{target=decodeURIComponent(target);}catch{return null;}if(target.includes('\\')||target.includes('\0'))return null;const parts=target.startsWith('/')?[]:source.split('/').slice(0,-1);for(const item of target.split('/')){if(!item||item==='.')continue;if(item==='..'){if(!parts.length)return null;parts.pop();}else parts.push(item);}return parts.join('/');}
  async function relationships(zip,source){const parts=source.split('/'),name=parts.pop(),file=parts.join('/')+'/_rels/'+name+'.rels',entry=zip.file(file);if(!entry)return new Map();const document=xml(await entry.async('string')),map=new Map();for(const rel of document.getElementsByTagNameNS('*','Relationship'))if(rel.getAttribute('TargetMode')!=='External'){const target=relationPath(source,rel.getAttribute('Target'));if(target)map.set(rel.getAttribute('Id'),target);}return map;}
  function textParagraphs(node){const paragraphs=[...node.getElementsByTagNameNS('*','p')];return paragraphs.map(p=>[...p.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('')).filter(Boolean).join('\n');}
  async function readPptx(buffer){
    const zip=await archive(buffer,['[Content_Types].xml','ppt/presentation.xml']),presentation=xml(await zip.file('ppt/presentation.xml').async('string')),rels=await relationships(zip,'ppt/presentation.xml'),references=[...presentation.getElementsByTagNameNS('*','sldId')];
    if(!references.length||references.length>100)throw new Error('DeckSuite supports 1 to 100 slides.');
    const slides=[],warnings=['PowerPoint imports preserve slide order, text and one supported image per slide. Layout, formatting, animations, charts and other objects may be simplified.'];
    for(const ref of references){
      const rel=ref.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||ref.getAttribute('r:id'),slidePath=rels.get(rel),entry=slidePath&&zip.file(slidePath);if(!entry)throw new Error('A PowerPoint slide is missing.');
      const slideDoc=xml(await entry.async('string')),slideRels=await relationships(zip,slidePath),shapes=[...slideDoc.getElementsByTagNameNS('*','sp')],parts=[];
      for(const shape of shapes){const value=textParagraphs(shape);if(!value)continue;const placeholder=shape.getElementsByTagNameNS('*','ph')[0],type=placeholder?.getAttribute('type');parts.push({value,title:type==='title'||type==='ctrTitle'});}
      const titleIndex=parts.findIndex(part=>part.title),chosen=titleIndex>=0?titleIndex:parts.length?0:-1,title=chosen<0?'':parts[chosen].value,body=parts.filter((_,i)=>i!==chosen).map(part=>part.value).join('\n');
      if(title.length>500||body.length>50000)throw new Error('A PowerPoint slide exceeds DeckSuite text limits.');
      let image='';const pictures=[...slideDoc.getElementsByTagNameNS('*','pic')];if(pictures.length>1)warnings.push('Only the first supported image on a slide is imported.');
      for(const picture of pictures){const blip=picture.getElementsByTagNameNS('*','blip')[0],id=blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','embed')||blip?.getAttribute('r:embed'),target=slideRels.get(id),media=target&&zip.file(target),ext=target?.split('.').pop().toLowerCase(),type={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'}[ext];if(!media||!type){warnings.push('An unsupported slide image was omitted.');continue;}const bytes=await media.async('uint8array');if(bytes.length>2*1024*1024)throw new Error('A slide image exceeds the 2 MB image limit.');image=dataUrl(bytes,type);break;}
      const backgroundNode=slideDoc.getElementsByTagNameNS('*','bgPr')[0]?.getElementsByTagNameNS('*','srgbClr')[0],color=backgroundNode?.getAttribute('val'),background=/^[0-9a-f]{6}$/i.test(color||'')?'#'+color:'#ffffff';
      if(slideDoc.getElementsByTagNameNS('*','graphicFrame').length)warnings.push('Tables, charts and other graphic objects are not imported.');
      slides.push({id:crypto.randomUUID(),title,body,image,background});
    }
    return {slides,warnings:unique(warnings)};
  }
  async function writePptx(state){
    const Pptx=await library('pptxgen','PptxGenJS'),deck=new Pptx();deck.layout='LAYOUT_WIDE';deck.author='RoomSuite';deck.title=state.title;
    for(const item of state.slides){const slide=deck.addSlide();slide.background={color:item.background.slice(1)};slide.addText(item.title||'',{x:0.8,y:0.65,w:11.7,h:0.9,fontFace:'Aptos',fontSize:32,bold:true,color:'272534',breakLine:false,fit:'shrink',margin:0});slide.addText(item.body||'',{x:0.8,y:1.8,w:item.image?6.1:11.7,h:4.8,fontFace:'Aptos',fontSize:20,color:'272534',fit:'shrink',valign:'top',margin:0});if(item.image){const image=await pngOrJpeg(item.image);slide.addImage({data:image,x:7.4,y:1.8,w:4.8,h:4.5,sizing:{type:'contain',w:4.8,h:4.5}});}}
    const result=await deck.write({outputType:'blob',compression:true});return {blob:result instanceof Blob?result:new Blob([result],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}),warnings:[]};
  }
  window.RoomOffice={readDocx,writeDocx,readXlsx,writeXlsx,readPptx,writePptx};
})();
