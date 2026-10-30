'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const Model=require('../ProductivitySuite/model');
const Grid=require('../ProductivitySuite/grid');
const {createReminders}=require('../ProductivitySuite/reminders');
const Calendar=require('../ProductivitySuite/calendar');

test('spreadsheet formulas calculate references, ranges and report errors',()=>{
  const cells={A1:'2',A2:'3',A3:'label',B1:'=SUM(A1:A3)',B2:'=AVERAGE(A1:A2)',B3:'=MAX(A1:A2)*2',C1:'=1/0',C2:'=C3',C3:'=C2',C4:'=UNKNOWN(A1)'};
  const calculate=Grid.calculate(cells,100,26);
  assert.equal(calculate('B1'),'5');assert.equal(calculate('B2'),'2.5');assert.equal(calculate('B3'),'6');
  assert.equal(calculate('C1'),'#DIV/0!');assert.equal(calculate('C2'),'#CYCLE!');assert.equal(calculate('C4'),'#NAME?');
  assert.equal(Grid.calculate({A1:'=Z500'},10,10)('A1'),'#REF!');
  assert.deepEqual(Grid.range('A1:A3',100,26),['A1','A2','A3']);assert.throws(()=>Grid.range('A1:B2',100,26),/single row or column/);
  const more=Grid.calculate({...cells,D1:'=IF(A1>1,"Yes",1/0)',D2:'=IF(FALSE,D2,ROUND(1.005,2))',D3:'=COUNTA(A1:A3)',D4:'="Coffee "&"and tea"',D5:'=10%+2',D6:'=AND(A1<3,A2>=3)',D7:'=ABS(-4)'},100,26);
  assert.equal(more('D1'),'Yes');assert.equal(more('D2'),'1.01');assert.equal(more('D3'),'3');assert.equal(more('D4'),'Coffee and tea');assert.equal(more('D5'),'2.1');assert.equal(more('D6'),'TRUE');assert.equal(more('D7'),'4');
});
test('SUMIF totals matching categories, comparisons and wildcards',()=>{
  const cells={A1:'Equipment',A2:'equipment',A3:'Marketing',A4:'Equip*',B1:'4800',B2:'1440',B3:'1200',B4:'20',C1:'=SUMIF(A1:A4,"Equipment",B1:B4)',C2:'=SUMIF(B1:B4,">=1200")',C3:'=SUMIF(A1:A4,"Equip*",B1:B4)',C4:'=SUMIF(A1:A4,"Equip~*",B1:B4)',C5:'=SUMIF(A1:A4,"<>Equipment",B1:B4)',C6:'=SUMIF(A1:A4,"Equipment",B1:B2)',C7:'=SUMIF(A1:A2,"Equipment",B1:C1)'};
  const calculate=Grid.calculate(cells,100,26);assert.equal(calculate('C1'),'6240');assert.equal(calculate('C2'),'7440');assert.equal(calculate('C3'),'6260');assert.equal(calculate('C4'),'20');assert.equal(calculate('C5'),'1220');assert.equal(calculate('C6'),'#VALUE!');assert.equal(calculate('C7'),'#VALUE!');
});
test('CSV preserves commas, quotes, newlines and empty values',()=>{
  const rows=[['Name','Note',''],['Alex','A "quoted",\nsecond line','42'],['','last','']];
  assert.deepEqual(Grid.parseCsv(Grid.toCsv(rows)),rows);assert.throws(()=>Grid.parseCsv('"unclosed'),/quote/i);
});
test('sorting keeps the header and preserves whole rows without changing formulas',()=>{
  const cells={A1:'Name',B1:'Price',A2:'Tea',B2:'3',A3:'Coffee',B3:'4',A4:'Bread',B4:'2'};
  assert.deepEqual(Grid.sortRows(cells,'A'),{A1:'Name',B1:'Price',A2:'Bread',B2:'2',A3:'Coffee',B3:'4',A4:'Tea',B4:'3'});
  assert.throws(()=>Grid.sortRows({...cells,C2:'=B2*2'},'A'),/formulas/);
});
test('workbooks preserve multiple sheets and imported cell types',()=>{
  const state=Model.empty('gridsuite',()=> 'id');state.cells.A1='=2+2';state.types.A1='text';state.sheets.push({id:'other',name:'Other',rows:100,columns:26,cells:{A1:'42'},chart:null,types:{},formats:{}});
  const saved=Model.validate(state,'gridsuite');assert.equal(saved.sheets.length,2);assert.equal(saved.sheets[0].cells.A1,'=2+2');assert.equal(Grid.calculate(saved.cells,100,26,saved.types)('A1'),'=2+2');assert.equal(saved.sheets[1].cells.A1,'42');
  assert.throws(()=>Model.validate({...state,sheets:[...state.sheets,{...state.sheets[1],id:'third'}]},'gridsuite'),/unique/);
});
test('calendar requires explicit time zones and validates event intervals',()=>{
  const calendar=Model.empty('plansuite',()=> 'id');
  calendar.events=[{id:'event',title:'Meeting',start:'2026-11-01T12:00:00+01:00',end:'2026-11-01T13:00:00+01:00',description:'',remindMinutes:15}];
  const valid=Model.validate(calendar,'plansuite');assert.equal(valid.events[0].start,'2026-11-01T11:00:00.000Z');
  assert.throws(()=>Model.validate({...calendar,events:[{...calendar.events[0],start:'2026-11-01T12:00'}]}),/offset/);
  assert.throws(()=>Model.validate({...calendar,events:[{...calendar.events[0],end:'2026-11-01T10:00:00Z'}]}),/end after/);
});
test('iCalendar export escapes text, folds UTF-8 lines and preserves reminders',()=>{
  const calendar=Calendar.ics([{id:'one',title:'A, B; café',start:'2026-11-01T11:00:00.000Z',end:'2026-11-01T12:00:00.000Z',description:'First\nSecond',remindMinutes:15}],new Date('2026-10-30T00:00:00Z'));
  assert.match(calendar,/DTSTART:20261101T110000Z/);assert.match(calendar,/SUMMARY:A\\, B\\; café/);assert.match(calendar,/DESCRIPTION:First\\nSecond/);assert.match(calendar,/TRIGGER:-PT15M/);
  const long=Calendar.ics([{id:'two',title:'é'.repeat(100),start:'2026-11-01T11:00:00.000Z',end:'2026-11-01T12:00:00.000Z',description:'',remindMinutes:null}]);for(const line of long.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
});
test('ntfy reminders use local saved events, keep tokens private, and avoid repeats',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-reminder-test-')),files=path.join(tmp,'files');await fs.mkdir(files);
  try{
    const calls=[];const reminders=createReminders({root:tmp,files,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response('ok',{status:200});}});
    await reminders.configure({enabled:true,server:'https://ntfy.example',topic:'private-topic',token:'test-token'});
    const settings=await reminders.settings();assert.equal(settings.hasToken,true);assert.equal(settings.token,undefined);
    const state=Model.empty('plansuite',()=> 'id');state.events=[{id:'event-1',title:'Appointment',start:'2026-05-01T10:00:00.000Z',end:'2026-05-01T11:00:00.000Z',description:'Private notes',remindMinutes:15}];
    await fs.writeFile(path.join(files,'calendar.plansuite'),JSON.stringify(state));
    assert.equal((await reminders.tick(Date.parse('2026-05-01T09:44:00Z'))).sent,0);
    assert.equal((await reminders.tick(Date.parse('2026-05-01T09:45:00Z'))).sent,1);
    assert.equal((await reminders.tick(Date.parse('2026-05-01T09:46:00Z'))).sent,0);
    assert.equal(calls.length,1);assert.equal(calls[0].url,'https://ntfy.example/private-topic');assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');assert.match(calls[0].options.body,/Appointment/);assert.doesNotMatch(calls[0].options.body,/Private notes/);
    await reminders.configure({enabled:false,server:'https://ntfy.example',topic:'private-topic'});assert.equal((await reminders.tick(Date.parse('2026-05-01T09:47:00Z'))).sent,0);
  }finally{const actual=await fs.realpath(tmp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-reminder-test-'));await fs.rm(actual,{recursive:true,force:true});}
});
test('failed reminders retry and deleted events are not sent',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-reminder-test-')),files=path.join(tmp,'files');await fs.mkdir(files);
  try{
    let attempts=0;const reminders=createReminders({root:tmp,files,fetchImpl:async()=>{attempts++;if(attempts===1)throw new Error('offline');return new Response('ok',{status:200});}});
    await reminders.configure({enabled:true,server:'https://ntfy.example',topic:'private-topic'});
    const state=Model.empty('plansuite',()=> 'id');state.events=[{id:'retry',title:'Retry',start:'2026-05-01T10:00:00.000Z',end:'2026-05-01T11:00:00.000Z',description:'',remindMinutes:15}];const file=path.join(files,'calendar.plansuite');await fs.writeFile(file,JSON.stringify(state));
    assert.equal((await reminders.tick(Date.parse('2026-05-01T09:45:00Z'))).sent,0);assert.match((await reminders.settings()).lastError,/retry/i);
    assert.equal((await reminders.tick(Date.parse('2026-05-01T09:46:00Z'))).sent,1);assert.equal(attempts,2);
    state.events=[{...state.events[0],id:'deleted'}];await fs.writeFile(file,JSON.stringify(state));await fs.unlink(file);assert.equal((await reminders.tick(Date.parse('2026-05-01T09:47:00Z'))).sent,0);assert.equal(attempts,2);
  }finally{const actual=await fs.realpath(tmp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-reminder-test-'));await fs.rm(actual,{recursive:true,force:true});}
});

test('v2.1 data survives validation and old files acquire safe defaults',()=>{
  const doc=Model.validate({format:'roomsuite-document',version:1,title:'Old',html:'<p>Text</p>'},'docsuite');assert.deepEqual(doc.comments,[]);
  doc.comments.push({id:'comment-1',text:'Review this',quote:'Text',author:'',resolved:false});assert.equal(Model.validate(doc,'docsuite').comments[0].quote,'Text');
  assert.throws(()=>Model.validate({...doc,comments:[...doc.comments,doc.comments[0]]},'docsuite'),/unique/);
  const grid=Model.empty('gridsuite',()=> 'id');grid.cells.A1='12';grid.styles={A1:{bold:true,color:'#123456',fill:'#abcdef',size:14,align:'right'}};grid.filter={column:'A',query:'12'};
  const saved=Model.validate(grid,'gridsuite');assert.deepEqual(saved.sheets[0].styles.A1,grid.styles.A1);assert.deepEqual(saved.sheets[0].filter,grid.filter);assert.throws(()=>Model.validate({...grid,filter:{column:'ZZ',query:'x'}},'gridsuite'),/outside/);
  const deck=Model.empty('decksuite',()=> 'slide');deck.slides[0].layout=Model.slideLayouts.split;assert.deepEqual(Model.validate(deck,'decksuite').slides[0].layout,Model.slideLayouts.split);assert.throws(()=>Model.validate({...deck,slides:[{...deck.slides[0],layout:{...Model.slideLayouts.split,title:{x:1,y:0,w:.2,h:.2}}}]},'decksuite'),/position/);
});
test('series edits and deletions leave unrelated events and occurrences intact',()=>{
  const events=[{id:'one',seriesId:'s',title:'Call',start:'2026-10-25T08:00:00Z',end:'2026-10-25T09:00:00Z',description:'',remindMinutes:null},{id:'two',seriesId:'s',title:'Call',start:'2026-11-01T09:00:00Z',end:'2026-11-01T10:00:00Z',description:'',remindMinutes:null},{id:'other',title:'Other',start:'2026-11-01T12:00:00Z',end:'2026-11-01T13:00:00Z',description:'',remindMinutes:null}];
  const one=Calendar.update(events,'one',{title:'Changed'},'occurrence');assert.equal(one[0].title,'Changed');assert.equal(one[1].title,'Call');
  const all=Calendar.update(events,'one',{title:'Team call',start:'2026-10-25T08:30:00Z',end:'2026-10-25T09:30:00Z'},'series');assert.equal(all[1].title,'Team call');assert.equal(all[1].start,'2026-11-01T09:30:00.000Z');assert.equal(all[2].title,'Other');assert.deepEqual(Calendar.remove(all,'two','series').map(e=>e.id),['other']);
  assert.throws(()=>Calendar.update(events,'missing',{},'series'),/not found/);
});
