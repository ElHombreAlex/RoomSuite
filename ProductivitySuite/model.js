'use strict';
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ProductivityModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const formats = { docsuite:'roomsuite-document', gridsuite:'roomsuite-spreadsheet', decksuite:'roomsuite-presentation', plansuite:'roomsuite-calendar' };
  const extensions = { docsuite:'.docsuite', gridsuite:'.gridsuite', decksuite:'.decksuite', plansuite:'.plansuite' };
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
    const cells={},types={},formats={};
    function address(key){const match=/^([A-Z]{1,2})([1-9]\d{0,2})$/.exec(key);if(!match)throw new Error('Invalid cell address.');let col=0;for(const char of match[1])col=col*26+char.charCodeAt(0)-64;if(col>columns||Number(match[2])>rows)throw new Error('Cell is outside the spreadsheet.');}
    for(const [key,value] of Object.entries(input.cells)){address(key);cells[key]=text(value,5000,'cell value');}
    for(const [key,value] of Object.entries(input.types||{})){address(key);if(!Object.hasOwn(cells,key)||!['text','date','boolean','error'].includes(value))throw new Error('Invalid cell type.');types[key]=value;}
    for(const [key,value] of Object.entries(input.formats||{})){address(key);if(!Object.hasOwn(cells,key))throw new Error('Cell format has no value.');formats[key]=text(value,255,'number format');}
    let chart=null;
    if(input.chart!==null&&input.chart!==undefined){
      if(!input.chart||!['bar','line'].includes(input.chart.type))throw new Error('Invalid chart type.');
      function chartRange(value){text(value,40,'chart range',true);const parts=value.toUpperCase().split(':');if(parts.length>2)throw new Error('Invalid chart range.');const points=parts.map(part=>{const m=/^([A-Z]{1,2})([1-9]\d{0,2})$/.exec(part);if(!m)throw new Error('Invalid chart range.');let col=0;for(const ch of m[1])col=col*26+ch.charCodeAt(0)-64;return {col,row:Number(m[2])};});const a=points[0],b=points[1]||a;if(a.col>columns||b.col>columns||a.row>rows||b.row>rows||(a.row!==b.row&&a.col!==b.col))throw new Error('Chart ranges must be a single row or column inside the grid.');const count=Math.abs(a.row-b.row)+Math.abs(a.col-b.col)+1;if(count>30)throw new Error('Charts support up to 30 values.');return {value:value.toUpperCase(),count};}
      const labels=chartRange(input.chart.labels),values=chartRange(input.chart.values);if(labels.count!==values.count)throw new Error('Chart label and value ranges must have the same length.');chart={type:input.chart.type,labels:labels.value,values:values.value};
    }
    return {rows,columns,cells,chart,types,formats};
  }
  function validate(input, expectedKind) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1) throw new Error('Invalid RoomSuite file.');
    const kind = Object.keys(formats).find(key => formats[key] === input.format);
    if (!kind || (expectedKind && kind !== expectedKind)) throw new Error('The file type does not match the suite.');
    const base = {format:formats[kind],version:1,title:text(input.title,160,'title',true)};
    if (kind === 'docsuite') return {...base,html:text(input.html,6*1024*1024,'document content')};
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
        return {id:slideId,title:text(slide.title,500,'slide title'),body:text(slide.body,50000,'slide text'),image:image(slide.image),background};
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
      return {id:eventId,title:text(event.title,160,'event title',true),start,end,description:text(event.description || '',10000,'event description'),remindMinutes};
    });
    return {...base,events};
  }
  function empty(kind, makeId) {
    const base={format:formats[kind],version:1,title:{docsuite:'Untitled document',gridsuite:'Untitled spreadsheet',decksuite:'Untitled presentation',plansuite:'My calendar'}[kind]};
    if (kind === 'docsuite') return {...base,html:'<p><br></p>'};
    if (kind === 'gridsuite') {const sheet={id:'sheet-1',name:'Sheet 1',rows:100,columns:26,cells:{},chart:null,types:{},formats:{}};return {...base,...sheetValues(sheet),activeSheetId:sheet.id,sheets:[sheet]};}
    if (kind === 'decksuite') return {...base,slides:[{id:makeId(),title:'New presentation',body:'Add your ideas here',image:'',background:'#ffffff'}]};
    if (kind === 'plansuite') return {...base,events:[]};
    throw new Error('Unknown suite.');
  }
  return {formats,extensions,validate,empty};
});
