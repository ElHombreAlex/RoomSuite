'use strict';
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ProductivityModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const formats = { docsuite:'roomsuite-document', gridsuite:'roomsuite-spreadsheet', decksuite:'roomsuite-presentation', plansuite:'roomsuite-calendar' };
  const extensions = { docsuite:'.docsuite', gridsuite:'.gridsuite', decksuite:'.decksuite', plansuite:'.plansuite' };
  const slideLayouts={standard:{title:{x:.06,y:.08,w:.88,h:.12},body:{x:.06,y:.24,w:.88,h:.64},image:{x:.55,y:.24,w:.36,h:.6}},split:{title:{x:.06,y:.08,w:.88,h:.12},body:{x:.06,y:.24,w:.46,h:.64},image:{x:.55,y:.24,w:.36,h:.6}},title:{title:{x:.1,y:.3,w:.8,h:.2},body:{x:.1,y:.53,w:.8,h:.25},image:{x:.68,y:.68,w:.22,h:.22}},statement:{title:{x:.1,y:.18,w:.8,h:.2},body:{x:.1,y:.42,w:.8,h:.38},image:{x:.72,y:.72,w:.2,h:.2}}};
  const text = (value, max, name, nonempty = false) => {
    if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) throw new Error('Invalid ' + name + '.');
    return value;
  };
  const id = value => text(value, 80, 'item ID', true);
  function date(value) {
    text(value, 40, 'event time', true);
    const match=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.exec(value);
    if (!match) throw new Error('Event times must include a UTC offset or Z.');
    const [year,month,day,hour,minute,second]=match.slice(1).map(part=>Number(part||0)), calendar=new Date(0);calendar.setUTCFullYear(year,month-1,day);
    if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day||hour>23||minute>59||second>59)throw new Error('Invalid event time.');
    const parsed=new Date(value); if (Number.isNaN(parsed.getTime())) throw new Error('Invalid event time.');
    return parsed.toISOString();
  }
  function image(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value !== 'string' || value.length > 3 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(value)) throw new Error('Images must be PNG, JPEG, GIF or WebP and at most 2 MB.');
    return value;
  }
  function sheetValues(input) {
    const rows=input.rows, columns=input.columns;
    if (!Number.isInteger(rows)||rows<1||rows>500||!Number.isInteger(columns)||columns<1||columns>52||!input.cells||typeof input.cells!=='object'||Array.isArray(input.cells)) throw new Error('Invalid spreadsheet dimensions or cells.');
    const cells={},types={},formats={},styles={};
    function address(key){const match=/^([A-Z]{1,2})([1-9]\d{0,2})$/.exec(key);if(!match)throw new Error('Invalid cell address.');let col=0;for(const char of match[1])col=col*26+char.charCodeAt(0)-64;if(col>columns||Number(match[2])>rows)throw new Error('Cell is outside the spreadsheet.');}
    for(const [key,value] of Object.entries(input.cells)){address(key);cells[key]=text(value,5000,'cell value');}
    for(const [key,value] of Object.entries(input.types||{})){address(key);if(!Object.hasOwn(cells,key)||!['text','date','boolean','error'].includes(value))throw new Error('Invalid cell type.');types[key]=value;}
    for(const [key,value] of Object.entries(input.formats||{})){address(key);if(!Object.hasOwn(cells,key))throw new Error('Cell format has no value.');formats[key]=text(value,255,'number format');}
    for(const [key,value] of Object.entries(input.styles||{})){
      address(key);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid cell style.');
      const style={};for(const prop of ['bold','italic','underline'])if(value[prop]!==undefined){if(typeof value[prop]!=='boolean')throw new Error('Invalid cell style.');style[prop]=value[prop];}
      for(const prop of ['color','fill'])if(value[prop]!==undefined){if(!/^#[0-9a-f]{6}$/i.test(value[prop]))throw new Error('Invalid cell color.');style[prop]=value[prop];}
      if(value.size!==undefined){if(!Number.isFinite(value.size)||value.size<1||value.size>200)throw new Error('Invalid cell font size.');style.size=value.size;}
      if(value.align!==undefined){if(!['left','center','right'].includes(value.align))throw new Error('Invalid cell alignment.');style.align=value.align;}
      styles[key]=style;
    }
    let filter=null;if(input.filter!==null&&input.filter!==undefined){const column=text(input.filter.column,2,'filter column',true).toUpperCase();address(column+'1');filter={column,query:text(input.filter.query,500,'filter text')};}
    let chart=null;
    if(input.chart!==null&&input.chart!==undefined){
      if(!input.chart||!['bar','line'].includes(input.chart.type))throw new Error('Invalid chart type.');
      function chartRange(value){text(value,40,'chart range',true);const parts=value.toUpperCase().split(':');if(parts.length>2)throw new Error('Invalid chart range.');const points=parts.map(part=>{const m=/^([A-Z]{1,2})([1-9]\d{0,2})$/.exec(part);if(!m)throw new Error('Invalid chart range.');let col=0;for(const ch of m[1])col=col*26+ch.charCodeAt(0)-64;return {col,row:Number(m[2])};});const a=points[0],b=points[1]||a;if(a.col>columns||b.col>columns||a.row>rows||b.row>rows||(a.row!==b.row&&a.col!==b.col))throw new Error('Chart ranges must be a single row or column inside the grid.');const count=Math.abs(a.row-b.row)+Math.abs(a.col-b.col)+1;if(count>30)throw new Error('Charts support up to 30 values.');return {value:value.toUpperCase(),count};}
      const labels=chartRange(input.chart.labels),values=chartRange(input.chart.values);if(labels.count!==values.count)throw new Error('Chart label and value ranges must have the same length.');chart={type:input.chart.type,labels:labels.value,values:values.value};
    }
    return {rows,columns,cells,chart,types,formats,styles,filter};
  }
  function validate(input, expectedKind) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1) throw new Error('Invalid RoomSuite file.');
    const kind = Object.keys(formats).find(key => formats[key] === input.format);
    if (!kind || (expectedKind && kind !== expectedKind)) throw new Error('The file type does not match the suite.');
    const base = {format:formats[kind],version:1,title:text(input.title,160,'title',true)};
    if (kind === 'docsuite') {
      const comments=input.comments||[];if(!Array.isArray(comments)||comments.length>1000)throw new Error('Invalid document comments.');const seen=new Set();
      return {...base,html:text(input.html,6*1024*1024,'document content'),comments:comments.map(comment=>{if(!comment||typeof comment!=='object')throw new Error('Invalid comment.');const commentId=id(comment.id);if(seen.has(commentId))throw new Error('Comment IDs must be unique.');seen.add(commentId);if(comment.resolved!==undefined&&typeof comment.resolved!=='boolean')throw new Error('Invalid comment status.');return {id:commentId,text:text(comment.text,10000,'comment',true),quote:text(comment.quote||'',1000,'comment context'),author:text(comment.author||'',160,'comment author'),resolved:!!comment.resolved};})};
    }
    if (kind === 'gridsuite') {
      const active=sheetValues(input),sheetList=input.sheets===undefined?[{id:'sheet-1',name:'Sheet 1',...active}]:input.sheets,activeSheetId=input.activeSheetId||'sheet-1';
      if(!Array.isArray(sheetList)||!sheetList.length||sheetList.length>20)throw new Error('A workbook needs 1 to 20 sheets.');
      const ids=new Set(),names=new Set(),sheets=sheetList.map(sheet=>{if(!sheet||typeof sheet!=='object')throw new Error('Invalid sheet.');const sheetId=id(sheet.id),name=text(sheet.name,31,'sheet name',true);if(/[\\/?*\[\]:]/.test(name)||/^'|'$/.test(name)||ids.has(sheetId)||names.has(name.toLowerCase()))throw new Error('Sheet names and IDs must be valid and unique.');ids.add(sheetId);names.add(name.toLowerCase());return {id:sheetId,name,...(sheetId===activeSheetId?active:sheetValues(sheet))};});
      if(!ids.has(activeSheetId))throw new Error('The active sheet is missing.');
      return {...base,...active,activeSheetId,sheets};
    }
    if (kind === 'decksuite') {
      if (!Array.isArray(input.slides) || !input.slides.length || input.slides.length>100) throw new Error('A presentation needs 1 to 100 slides.');
      const seen=new Set();
      const slides=input.slides.map(slide => {
        if (!slide || typeof slide !== 'object') throw new Error('Invalid slide.');
        const slideId=id(slide.id); if (seen.has(slideId)) throw new Error('Slide IDs must be unique.'); seen.add(slideId);
        const background=slide.background || '#ffffff'; if (!/^#[0-9a-f]{6}$/i.test(background)) throw new Error('Invalid slide background.');
        let layout;if(slide.layout!==undefined){if(!slide.layout||typeof slide.layout!=='object')throw new Error('Invalid slide layout.');layout={};for(const part of ['title','body','image']){const box=slide.layout[part];if(!box||typeof box!=='object'||['x','y','w','h'].some(key=>!Number.isFinite(box[key]))||box.x<0||box.y<0||box.w<=0||box.h<=0||box.x+box.w>1.001||box.y+box.h>1.001)throw new Error('Invalid slide position.');layout[part]={x:box.x,y:box.y,w:box.w,h:box.h};}}
        return {id:slideId,title:text(slide.title,500,'slide title'),body:text(slide.body,50000,'slide text'),image:image(slide.image),background,...(layout?{layout}:{})};
      });
      return {...base,slides};
    }
    if (!Array.isArray(input.events) || input.events.length>5000) throw new Error('Invalid calendar events.');
    const seen=new Set();
    const events=input.events.map(event => {
      if (!event || typeof event !== 'object') throw new Error('Invalid event.');
      const eventId=id(event.id); if (seen.has(eventId)) throw new Error('Event IDs must be unique.'); seen.add(eventId);
      const start=date(event.start), end=date(event.end); if (end<=start) throw new Error('An event must end after it starts.');
      const remindMinutes=event.remindMinutes === undefined || event.remindMinutes === null ? null : event.remindMinutes;
      if (remindMinutes !== null && (!Number.isInteger(remindMinutes) || remindMinutes<0 || remindMinutes>10080)) throw new Error('A reminder must be 0 to 10080 minutes before the event.');
      return {id:eventId,title:text(event.title,160,'event title',true),start,end,description:text(event.description || '',10000,'event description'),remindMinutes,...(event.seriesId?{seriesId:id(event.seriesId)}:{})};
    });
    return {...base,events};
  }
  function empty(kind, makeId) {
    const base={format:formats[kind],version:1,title:{docsuite:'Untitled document',gridsuite:'Untitled spreadsheet',decksuite:'Untitled presentation',plansuite:'My calendar'}[kind]};
    if (kind === 'docsuite') return {...base,html:'<p><br></p>',comments:[]};
    if (kind === 'gridsuite') {const sheet={id:'sheet-1',name:'Sheet 1',rows:100,columns:26,cells:{},chart:null,types:{},formats:{}};return {...base,...sheetValues(sheet),activeSheetId:sheet.id,sheets:[sheet]};}
    if (kind === 'decksuite') return {...base,slides:[{id:makeId(),title:'New presentation',body:'Add your ideas here',image:'',background:'#ffffff'}]};
    if (kind === 'plansuite') return {...base,events:[]};
    throw new Error('Unknown suite.');
  }
  return {formats,extensions,slideLayouts,validate,empty};
});
