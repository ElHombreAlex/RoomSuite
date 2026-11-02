'use strict';
(function (root, factory) {
  const model = factory(typeof module === 'object' && module.exports ? require('./ical') : root.CalendarImport,typeof module === 'object' && module.exports ? require('./annotations') : root.DocAnnotations,typeof module === 'object' && module.exports ? require('./changes') : root.DocChanges);
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ProductivityModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CalendarImport,DocAnnotations,DocChanges) {
  const formats = { docsuite:'roomsuite-document', gridsuite:'roomsuite-spreadsheet', decksuite:'roomsuite-presentation', plansuite:'roomsuite-calendar' };
  const extensions = { docsuite:'.docsuite', gridsuite:'.gridsuite', decksuite:'.decksuite', plansuite:'.plansuite' };
  const slideLayouts={standard:{title:{x:.06,y:.08,w:.88,h:.12},body:{x:.06,y:.24,w:.88,h:.64},image:{x:.55,y:.24,w:.36,h:.6}},split:{title:{x:.06,y:.08,w:.88,h:.12},body:{x:.06,y:.24,w:.46,h:.64},image:{x:.55,y:.24,w:.36,h:.6}},title:{title:{x:.1,y:.3,w:.8,h:.2},body:{x:.1,y:.53,w:.8,h:.25},image:{x:.68,y:.68,w:.22,h:.22}},statement:{title:{x:.1,y:.18,w:.8,h:.2},body:{x:.1,y:.42,w:.8,h:.38},image:{x:.72,y:.72,w:.2,h:.2}}};
  const deckFonts=['Aptos','Arial','Georgia','Verdana','Times New Roman','Trebuchet MS','Courier New'];
  const deckTextStyles={title:{font:'Aptos',size:32,bold:true,italic:false,align:'left',lineHeight:1.2,color:'#272534'},body:{font:'Aptos',size:20,bold:false,italic:false,align:'left',lineHeight:1.2,color:'#272534'}};
  function slideTextStyles(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid slide text styles.');
    const result={};for(const part of ['title','body']){
      const input=value[part]||{},style={...deckTextStyles[part],...input};
      if(!input||typeof input!=='object'||Array.isArray(input)||!deckFonts.includes(style.font)||!Number.isFinite(style.size)||style.size<8||style.size>120||typeof style.bold!=='boolean'||typeof style.italic!=='boolean'||!['left','center','right'].includes(style.align)||!Number.isFinite(style.lineHeight)||style.lineHeight<.8||style.lineHeight>3||!/^#[0-9a-f]{6}$/i.test(style.color))throw new Error('Invalid slide text style.');
      result[part]={font:style.font,size:style.size,bold:style.bold,italic:style.italic,align:style.align,lineHeight:style.lineHeight,color:style.color};
    }return result;
  }
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
      const labels=chartRange(input.chart.labels);let series;
      if(input.chart.series!==undefined){if(!Array.isArray(input.chart.series)||!input.chart.series.length||input.chart.series.length>6)throw new Error('Charts support 1 to 6 series.');series=input.chart.series.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid chart series.');const name=text(item.name,80,'series name',true).trim();if(/[\u0000-\u001f\u007f-\u009f]/.test(name))throw new Error('Invalid series name.');const values=chartRange(item.values);if(labels.count!==values.count)throw new Error('Chart label and value ranges must have the same length.');return {name,values:values.value};});if(input.chart.values!==undefined&&chartRange(input.chart.values).value!==series[0].values)throw new Error('The first chart series must match the values range.');}
      const values=series?{value:series[0].values,count:labels.count}:chartRange(input.chart.values);if(labels.count!==values.count)throw new Error('Chart label and value ranges must have the same length.');chart={type:input.chart.type,labels:labels.value,values:values.value,...(series?{series}:{})};
    }
    return {rows,columns,cells,chart,types,formats,styles,filter};
  }
  function needsVersion2(input,kind){
    if(kind==='docsuite')return input.changes!==undefined||(Array.isArray(input.comments)&&input.comments.some(comment=>comment?.anchor!==undefined));
    if(kind==='decksuite')return Array.isArray(input.slides)&&input.slides.some(slide=>slide?.notes!==undefined||slide?.elements!==undefined);
    if(kind==='plansuite')return Array.isArray(input.events)&&input.events.some(event=>event?.icalUid!==undefined||event?.icalSeries!==undefined||event?.allDay!==undefined);
    if(kind==='gridsuite')return [input,...(Array.isArray(input.sheets)?input.sheets:[])].some(sheet=>sheet?.chart?.series!==undefined||Object.values(sheet?.cells||{}).some(value=>typeof value==='string'&&value.startsWith('=')&&value.includes('!')));
    return false;
  }
  function validate(input, expectedKind) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || ![1,2].includes(input.version)) throw new Error('Invalid RoomSuite file.');
    const kind = Object.keys(formats).find(key => formats[key] === input.format);
    if (!kind || (expectedKind && kind !== expectedKind)) throw new Error('The file type does not match the suite.');
    const base = {format:formats[kind],version:input.version===2||needsVersion2(input,kind)?2:1,title:text(input.title,160,'title',true)};
    if (kind === 'docsuite') {
      const comments=input.comments||[];if(!Array.isArray(comments)||comments.length>1000)throw new Error('Invalid document comments.');const seen=new Set();
      let changes;if(input.changes!==undefined){if(!Array.isArray(input.changes)||input.changes.length>DocChanges.maxChanges)throw new Error('Invalid tracked changes.');const ids=new Set();changes=input.changes.map(change=>{if(!DocChanges.valid(change)||ids.has(change.id)||Object.keys(change).some(key=>!['id','start','inserted','deleted','conflicted','left','right','leftEdge','rightEdge'].includes(key)))throw new Error('Invalid tracked change.');ids.add(change.id);return {id:change.id,start:change.start,inserted:change.inserted,deleted:change.deleted,conflicted:change.conflicted,left:change.left,right:change.right,leftEdge:change.leftEdge,rightEdge:change.rightEdge};});}
      return {...base,html:text(input.html,6*1024*1024,'document content'),comments:comments.map(comment=>{if(!comment||typeof comment!=='object')throw new Error('Invalid comment.');const commentId=id(comment.id);if(seen.has(commentId))throw new Error('Comment IDs must be unique.');seen.add(commentId);if(comment.resolved!==undefined&&typeof comment.resolved!=='boolean')throw new Error('Invalid comment status.');let anchor;if(comment.anchor!==undefined){if(!DocAnnotations.valid(comment.anchor)||Object.keys(comment.anchor).some(key=>!['start','end','text','orphaned'].includes(key)))throw new Error('Invalid comment anchor.');anchor={start:comment.anchor.start,end:comment.anchor.end,text:comment.anchor.text,orphaned:comment.anchor.orphaned};}return {id:commentId,text:text(comment.text,10000,'comment',true),quote:text(comment.quote||'',1000,'comment context'),author:text(comment.author||'',160,'comment author'),resolved:!!comment.resolved,...(anchor?{anchor}:{})};}),...(changes?{changes}:{})};
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
        const textStyles=slide.textStyles===undefined?undefined:slideTextStyles(slide.textStyles);
        const notes=slide.notes===undefined?undefined:text(slide.notes,10000,'speaker notes');
        let elements;if(slide.elements!==undefined){if(!Array.isArray(slide.elements)||slide.elements.length>30)throw new Error('A slide supports up to 30 additional elements.');const ids=new Set();elements=slide.elements.map(element=>{if(!element||!['text','image'].includes(element.type))throw new Error('Invalid slide element.');const elementId=id(element.id);if(!/^[A-Za-z0-9_-]{1,80}$/.test(elementId))throw new Error('Invalid slide element ID.');if(ids.has(elementId))throw new Error('Slide element IDs must be unique.');ids.add(elementId);const box=element.box;if(!box||typeof box!=='object'||['x','y','w','h'].some(key=>!Number.isFinite(box[key]))||box.x<0||box.y<0||box.w<=0||box.h<=0||box.x+box.w>1.001||box.y+box.h>1.001)throw new Error('Invalid slide element position.');const clean={id:elementId,type:element.type,box:{x:box.x,y:box.y,w:box.w,h:box.h}};if(element.type==='text'){clean.text=text(element.text,5000,'slide element text');clean.style=slideTextStyles({body:element.style||{}}).body;}else{clean.data=image(element.data);if(!clean.data)throw new Error('A slide image is required.');}return clean;});}
        return {id:slideId,title:text(slide.title,500,'slide title'),body:text(slide.body,50000,'slide text'),image:image(slide.image),background,...(layout?{layout}:{}),...(textStyles?{textStyles}:{}),...(notes!==undefined?{notes}:{}),...(elements?{elements}:{})};
      });
      return {...base,slides};
    }
    if (!Array.isArray(input.events) || input.events.length>5000) throw new Error('Invalid calendar events.');
    const seen=new Set(),seriesGroups=new Map(),seriesKinds=new Map(),recurrenceCache=new Map();
    const events=input.events.map(event => {
      if (!event || typeof event !== 'object') throw new Error('Invalid event.');
      const eventId=id(event.id); if (seen.has(eventId)) throw new Error('Event IDs must be unique.'); seen.add(eventId);
      const start=date(event.start), end=date(event.end); if (end<=start) throw new Error('An event must end after it starts.');
      if(event.allDay!==undefined&&(event.allDay!==true||!start.endsWith('T00:00:00.000Z')||!end.endsWith('T00:00:00.000Z')))throw new Error('An all-day event needs date-only start and end values.');
      const remindMinutes=event.remindMinutes === undefined || event.remindMinutes === null ? null : event.remindMinutes;
      if (remindMinutes !== null && (!Number.isInteger(remindMinutes) || remindMinutes<0 || remindMinutes>10080)) throw new Error('A reminder must be 0 to 10080 minutes before the event.');
      const icalUid=event.icalUid===undefined?undefined:text(event.icalUid,255,'iCalendar UID',true);if(icalUid&&/[\x00-\x1f\x7f]/.test(icalUid))throw new Error('Invalid iCalendar UID.');
      if(event.seriesId){const type=event.icalSeries!==undefined;if(seriesKinds.has(event.seriesId)&&seriesKinds.get(event.seriesId)!==type)throw new Error('Inconsistent recurring series.');seriesKinds.set(event.seriesId,type);}let icalSeries;if(event.icalSeries!==undefined){icalSeries=CalendarImport.validSeries(event.icalSeries,recurrenceCache);if(!event.seriesId||icalUid!==icalSeries.uid||!!event.allDay!==!!icalSeries.allDay)throw new Error('Invalid recurring series ID or date type.');const {occurrence,...master}=icalSeries,key=JSON.stringify(master),group=seriesGroups.get(event.seriesId)||{key,occurrences:new Set()};if(group.key!==key||group.occurrences.has(occurrence))throw new Error('Inconsistent recurring series.');group.occurrences.add(occurrence);seriesGroups.set(event.seriesId,group);}
      return {id:eventId,title:text(event.title,160,'event title',true),start,end,description:text(event.description || '',10000,'event description'),remindMinutes,...(event.allDay?{allDay:true}:{}),...(event.seriesId?{seriesId:id(event.seriesId)}:{}),...(icalUid?{icalUid}:{}),...(icalSeries?{icalSeries}:{})};
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
  return {formats,extensions,slideLayouts,deckFonts,deckTextStyles,slideTextStyles,validate,empty};
});
