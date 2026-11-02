'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Import=require('../ProductivitySuite/ical'),Model=require('../ProductivitySuite/model'),Calendar=require('../ProductivitySuite/calendar');
const Zone=require('../ProductivitySuite/timezone');
let id=0;const next=()=>String(++id);
const event=(uid,start,end,extra='')=>`BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:Hello\\, world\r\nDESCRIPTION:First\\nSecond\r\n${extra}END:VEVENT\r\n`;
const wrap=events=>'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'+events+'END:VCALENDAR\r\n';

test('all-day dates and recurring exceptions retain their date-only meaning',()=>{
  const single='BEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:20240330\r\nDTEND;VALUE=DATE:20240402\r\nSUMMARY:Holiday\r\nEND:VEVENT\r\n',implicit='BEGIN:VEVENT\r\nUID:one-day\r\nDTSTART;VALUE=DATE:20240501\r\nSUMMARY:One day\r\nEND:VEVENT\r\n';
  const repeat='BEGIN:VEVENT\r\nUID:repeat-date\r\nDTSTART;VALUE=DATE:20240401\r\nDTEND;VALUE=DATE:20240402\r\nSUMMARY:Repeat\r\nRRULE:FREQ=DAILY;UNTIL=20240404\r\nEXDATE;VALUE=DATE:20240403\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:repeat-date\r\nRECURRENCE-ID;VALUE=DATE:20240402\r\nDTSTART;VALUE=DATE:20240405\r\nDTEND;VALUE=DATE:20240407\r\nSUMMARY:Moved\r\nEND:VEVENT\r\n';
  const parsed=Import.parse(wrap(single+implicit+repeat),next);assert.equal(parsed.events.length,5);assert.ok(parsed.events.every(item=>item.allDay));assert.equal(parsed.events[0].start,'2024-03-30T00:00:00.000Z');assert.equal(parsed.events[0].end,'2024-04-02T00:00:00.000Z');assert.equal(parsed.events[1].end,'2024-05-02T00:00:00.000Z');
  const state=Model.validate({...Model.empty('plansuite',next),events:parsed.events},'plansuite');assert.equal(state.version,2);const output=Calendar.ics(state.events,new Date('2024-01-01T00:00:00Z'));assert.match(output,/DTSTART;VALUE=DATE:20240330/);assert.match(output,/DTEND;VALUE=DATE:20240402/);assert.match(output,/EXDATE;VALUE=DATE:20240403/);assert.match(output,/RECURRENCE-ID;VALUE=DATE:20240402/);assert.match(output,/UNTIL=20240404/);
  const again=Import.parse(output,next).events;assert.deepEqual(again.map(({title,start,end,allDay})=>({title,start,end,allDay})),state.events.map(({title,start,end,allDay})=>({title,start,end,allDay})));
  assert.throws(()=>Import.parse(wrap(single.replace('20240330','20240230')),next),/date/i);assert.throws(()=>Import.parse(wrap(single.replace('DTEND;VALUE=DATE:20240402','DTEND:20240402T000000Z')),next),/same date type/i);assert.throws(()=>Import.parse(wrap(repeat.replace('EXDATE;VALUE=DATE:20240403','EXDATE:20240403T000000Z')),next),/same date type/i);
  assert.throws(()=>Model.validate({...state,events:[{...state.events[0],start:'2024-03-30T09:00:00.000Z'}]},'plansuite'),/date-only/i);
});

test('IANA local times follow daylight saving, skip missing times and resolve overlaps consistently',()=>{
  assert.throws(()=>Zone.parseLocal('20240331T023000','Europe/Paris'),/does not exist/);
  assert.equal(new Date(Zone.parseLocal('20241027T023000','Europe/Paris')).toISOString(),'2024-10-27T00:30:00.000Z');
  assert.equal(new Date(Zone.parseLocal('20241103T013000','America/New_York')).toISOString(),'2024-11-03T05:30:00.000Z');
  assert.throws(()=>Zone.parseLocal('20240101T090000','Not/AZone'),/time zone/);
  assert.throws(()=>Zone.parseLocal('19691231T090000','Europe/Paris'),/1970/);
  const expected=['2024-03-24T01:30:00.000Z','2024-04-07T00:30:00.000Z','2024-04-14T00:30:00.000Z'];
  for(const rule of ['FREQ=WEEKLY;COUNT=3','FREQ=WEEKLY;UNTIL=20240414T003000Z'])assert.deepEqual(Import.recurrence(Date.parse(expected[0]),rule,'Europe/Paris').map(value=>new Date(value).toISOString()),expected);
  assert.throws(()=>Import.series({uid:'empty-zone',rule:'FREQ=DAILY;COUNT=2',start:expected[0],end:'2024-03-24T02:30:00.000Z',title:'Meeting',description:'',remindMinutes:null,tzid:''},next),/Invalid recurring series/);
});

test('time-zone recurrence and its edited or deleted occurrences survive iCalendar round trips',()=>{
  const input=wrap('BEGIN:VEVENT\r\nUID:paris\r\nDTSTART;TZID=Europe/Paris:20240324T090000\r\nDTEND;TZID=Europe/Paris:20240324T100000\r\nSUMMARY:Weekly\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEND:VEVENT\r\n');
  const original=Import.parse(input,next).events;assert.deepEqual(original.map(item=>item.start),['2024-03-24T08:00:00.000Z','2024-03-31T07:00:00.000Z','2024-04-07T07:00:00.000Z','2024-04-14T07:00:00.000Z']);
  let changed=Calendar.update(original,original[1].id,{title:'Changed'},'occurrence');changed=Calendar.remove(changed,original[2].id,'occurrence');
  const state=Model.validate({...Model.empty('plansuite',next),events:changed},'plansuite');assert.equal(state.version,2);
  const output=Calendar.ics(state.events,new Date('2024-01-01T00:00:00Z'));
  assert.match(output,/BEGIN:VTIMEZONE/);assert.match(output,/DTSTART;TZID=Europe\/Paris:20240324T090000/);assert.match(output,/RECURRENCE-ID;TZID=Europe\/Paris:20240331T090000/);assert.match(output,/EXDATE;TZID=Europe\/Paris:20240407T090000/);
  const again=Import.parse(output,next);assert.deepEqual(again.events.map(({start,end,title})=>({start,end,title})),state.events.map(({start,end,title})=>({start,end,title})));assert.ok(again.warnings.some(value=>value.includes('device')));
});
test('iCalendar import handles folded text, reminders and finite UTC recurrence dates',()=>{
  const input=wrap(event('one','20240101T090000Z','20240101T100000Z','LOCATION:Office\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\n')+event('month','20240131T090000Z','20240131T100000Z','RRULE:FREQ=MONTHLY;COUNT=4\r\n')+event('week','20240101T090000Z','20240101T100000Z','RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=MO,\r\n WE\r\n'));
  const result=Import.parse(input,next);assert.equal(result.events.length,9);assert.equal(result.events[0].title,'Hello, world');assert.equal(result.events[0].description,'First\nSecond');assert.equal(result.events[0].remindMinutes,15);assert.ok(result.warnings.some(item=>item.includes('locations')));
  assert.deepEqual(result.events.filter(item=>item.icalUid==='month').map(item=>item.start.slice(0,10)),['2024-01-31','2024-03-31','2024-05-31','2024-07-31']);assert.deepEqual(result.events.filter(item=>item.icalUid==='week').map(item=>item.start.slice(0,10)),['2024-01-01','2024-01-03','2024-01-15','2024-01-17']);
  const state=Model.validate({...Model.empty('plansuite',next),events:result.events},'plansuite');assert.equal(state.events.length,9);assert.equal(state.events[1].icalUid,'month');const duplicate=Import.merge(state.events,result.events);assert.equal(duplicate.added,0);assert.equal(duplicate.skipped,3);
  const output=Calendar.ics(state.events);assert.match(output,/RRULE:FREQ=MONTHLY;COUNT=4/);assert.match(output,/RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=MO,WE/);const roundtrip=Import.parse(output,next);assert.equal(roundtrip.events.length,9);assert.equal(roundtrip.events.filter(item=>item.icalUid==='month')[0].icalSeries.rule,'FREQ=MONTHLY;COUNT=4');
});
test('unsupported iCalendar semantics fail visibly rather than changing event dates',()=>{
  const cases=[event('x','20240101T090000','20240101T100000'),event('x','20240101T090000Z','20240101T100000Z','RRULE:FREQ=DAILY\r\n'),event('x','20240101T090000Z','20240101T100000Z','RRULE:FREQ=MONTHLY;COUNT=2;BYHOUR=9\r\n'),event('x','20240101T090000Z','20240101T100000Z','RDATE:20240102T090000Z\r\n'),event('x','20240230T090000Z','20240301T100000Z'),event('x','20240101T090000Z','20240101T100000Z')+event('x','20240102T090000Z','20240102T100000Z')];for(const value of cases)assert.throws(()=>Import.parse(wrap(value),next));
  assert.throws(()=>Import.parse(wrap(event('x','20240101T090000Z','20240101T100000Z','RRULE:FREQ=DAILY;UNTIL=20241231T090000Z\r\n')),next),/52/);
});
test('common RRULE selectors follow calendar periods and round-trip through iCalendar',()=>{
  const examples=[
    ['monthdays','20240102T090000Z','FREQ=MONTHLY;COUNT=6;BYMONTHDAY=2,15',['2024-01-02','2024-01-15','2024-02-02','2024-02-15','2024-03-02','2024-03-15']],
    ['lastworkday','20240131T090000Z','FREQ=MONTHLY;COUNT=4;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',['2024-01-31','2024-02-29','2024-03-29','2024-04-30']],
    ['sundays','20240204T090000Z','FREQ=MONTHLY;COUNT=4;BYDAY=1SU,-1SU',['2024-02-04','2024-02-25','2024-03-03','2024-03-31']],
    ['leap','20240229T090000Z','FREQ=YEARLY;COUNT=3;BYMONTH=2;BYMONTHDAY=29',['2024-02-29','2028-02-29','2032-02-29']],
    ['weekstart','20240107T090000Z','FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=SU,TU;WKST=SU',['2024-01-07','2024-01-09','2024-01-21','2024-01-23']]
  ];
  for(const [uid,start,rule,dates]of examples){const parsed=Import.parse(wrap(event(uid,start,start.replace('T090000','T100000'),'RRULE:'+rule+'\r\n')),next).events;assert.deepEqual(parsed.map(item=>item.start.slice(0,10)),dates,uid);const output=Calendar.ics(Model.validate({...Model.empty('plansuite',next),events:parsed},'plansuite').events);assert.match(output,/RRULE:/);assert.deepEqual(Import.parse(output,next).events.map(item=>item.start.slice(0,10)),dates,uid+' round trip');}
  for(const rule of ['FREQ=WEEKLY;COUNT=3;BYMONTHDAY=1','FREQ=WEEKLY;COUNT=3;BYDAY=1MO','FREQ=MONTHLY;COUNT=3;BYSETPOS=1','FREQ=MONTHLY;COUNT=3;BYMONTHDAY=0'])assert.throws(()=>Import.recurrence(Date.parse('2024-01-01T09:00:00Z'),rule));
});
test('recurring edits and deletions export and import as RRULE exceptions',()=>{
  const source=Import.parse(wrap(event('repeat','20240101T090000Z','20240101T100000Z','RRULE:FREQ=DAILY;COUNT=4\r\n')),next).events;
  let changed=Calendar.update(source,source[1].id,{title:'Moved',start:'2024-01-02T11:00:00.000Z',end:'2024-01-02T12:00:00.000Z'},'occurrence');changed=Calendar.remove(changed,source[2].id,'occurrence');const state=Model.validate({...Model.empty('plansuite',next),events:changed},'plansuite'),output=Calendar.ics(state.events);assert.match(output,/RRULE:FREQ=DAILY;COUNT=4/);assert.match(output,/EXDATE:20240103T090000Z/);assert.match(output,/RECURRENCE-ID:20240102T090000Z/);const imported=Import.parse(output,next).events;assert.equal(imported.length,3);assert.deepEqual(imported.map(item=>[item.start,item.title]),state.events.map(item=>[item.start,item.title]));
  const shifted=Calendar.update(source,source[0].id,{start:'2024-01-01T10:00:00.000Z',end:'2024-01-01T11:00:00.000Z',title:'Shifted'},'series');assert.ok(shifted.every(item=>item.title==='Shifted'));assert.match(Calendar.ics(Model.validate({...Model.empty('plansuite',next),events:shifted},'plansuite').events),/DTSTART:20240101T100000Z/);
  const month=Import.parse(wrap(event('month','20240131T090000Z','20240131T100000Z','RRULE:FREQ=MONTHLY;COUNT=3\r\n')),next).events;assert.throws(()=>Calendar.update(month,month[0].id,{start:'2024-01-30T09:00:00.000Z',end:'2024-01-30T10:00:00.000Z'},'series'),/pattern/);
});
