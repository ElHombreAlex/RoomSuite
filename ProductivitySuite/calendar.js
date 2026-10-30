'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CalendarModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const escape=value=>String(value).replaceAll('\\','\\\\').replaceAll('\r\n','\n').replaceAll('\r','\n').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');
  const stamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  function fold(line){let result='',part='',length=0;for(const char of line){const bytes=new TextEncoder().encode(char).length;if(length+bytes>75){result+=part+'\r\n';part=' ';length=1;}part+=char;length+=bytes;}return result+part;}
  function ics(events,now=new Date()){
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//RoomSuite//PlanSuite//EN','CALSCALE:GREGORIAN'];
    for(const event of events){lines.push('BEGIN:VEVENT','UID:'+escape(event.id)+'@roomsuite.local','DTSTAMP:'+stamp(now),'DTSTART:'+stamp(event.start),'DTEND:'+stamp(event.end),'SUMMARY:'+escape(event.title));if(event.description)lines.push('DESCRIPTION:'+escape(event.description));if(event.remindMinutes!==null&&event.remindMinutes!==undefined)lines.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+escape(event.title),'TRIGGER:-PT'+event.remindMinutes+'M','END:VALARM');lines.push('END:VEVENT');}
    lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';
  }
  // Repetitions are stored as bounded, individually timed events. Grouping
  // lets an edit affect the series while reminders and ICS remain per event.
  function update(events,eventId,changes,scope='occurrence'){
    if(!['occurrence','series'].includes(scope))throw new Error('Invalid event edit scope.');
    const selected=events.find(event=>event.id===eventId);if(!selected)throw Object.assign(new Error('Event not found.'),{code:'NOT_FOUND'});
    const startDelta=changes.start===undefined?0:Date.parse(changes.start)-Date.parse(selected.start),endDelta=changes.end===undefined?0:Date.parse(changes.end)-Date.parse(selected.end);
    if(!Number.isFinite(startDelta)||!Number.isFinite(endDelta))throw new Error('Invalid event time.');
    return events.map(event=>{
      if(event.id!==eventId&&!(scope==='series'&&selected.seriesId&&event.seriesId===selected.seriesId))return event;
      const next={...event};for(const key of ['title','description','remindMinutes'])if(changes[key]!==undefined)next[key]=changes[key];
      if(changes.start!==undefined)next.start=new Date(Date.parse(event.start)+startDelta).toISOString();
      if(changes.end!==undefined)next.end=new Date(Date.parse(event.end)+endDelta).toISOString();
      return next;
    });
  }
  function remove(events,eventId,scope='occurrence'){
    if(!['occurrence','series'].includes(scope))throw new Error('Invalid event edit scope.');
    const selected=events.find(event=>event.id===eventId);if(!selected)throw Object.assign(new Error('Event not found.'),{code:'NOT_FOUND'});
    return events.filter(event=>event.id!==eventId&&!(scope==='series'&&selected.seriesId&&event.seriesId===selected.seriesId));
  }
  return {ics,update,remove};
});
