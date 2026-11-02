'use strict';
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./ical'):root.CalendarImport,typeof module==='object'&&module.exports?require('./timezone'):root.CalendarZone);if(typeof module==='object'&&module.exports)module.exports=api;else root.CalendarModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(CalendarImport,Zone){
  const escape=value=>String(value).replaceAll('\\','\\\\').replaceAll('\r\n','\n').replaceAll('\r','\n').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');
  const stamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  function fold(line){let result='',part='',length=0;for(const char of line){const bytes=new TextEncoder().encode(char).length;if(length+bytes>75){result+=part+'\r\n';part=' ';length=1;}part+=char;length+=bytes;}return result+part;}
  function ics(events,now=new Date()){
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//RoomSuite//PlanSuite//EN','CALSCALE:GREGORIAN'],groups=new Map(),cache=new Map(),zones=new Map();
    const dayStamp=value=>stamp(value).slice(0,8);
    const emit=(event,uid,extra=[],tzid)=>{const start=event.allDay?'DTSTART;VALUE=DATE:'+dayStamp(event.start):tzid?'DTSTART;TZID='+tzid+':'+Zone.stamp(Zone.toWall(Date.parse(event.start),tzid)):'DTSTART:'+stamp(event.start),end=event.allDay?'DTEND;VALUE=DATE:'+dayStamp(event.end):'DTEND:'+stamp(event.end);lines.push('BEGIN:VEVENT','UID:'+escape(uid),'DTSTAMP:'+stamp(now),start,end,'SUMMARY:'+escape(event.title),...extra);if(event.description)lines.push('DESCRIPTION:'+escape(event.description));if(event.remindMinutes!==null&&event.remindMinutes!==undefined)lines.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+escape(event.title),'TRIGGER:-PT'+event.remindMinutes+'M','END:VALARM');lines.push('END:VEVENT');};
    for(const event of events){if(!event.icalSeries){emit(event,event.seriesId?event.id+'@roomsuite.local':event.icalUid||event.id+'@roomsuite.local');continue;}const meta=CalendarImport.validSeries(event.icalSeries,cache);if(!event.seriesId||event.icalUid!==meta.uid)throw new Error('Invalid recurring series.');const {occurrence,...master}=meta,key=JSON.stringify(master),group=groups.get(event.seriesId)||{key,master,occurrences:new Map()};if(group.key!==key||group.occurrences.has(occurrence))throw new Error('Inconsistent recurring series.');group.occurrences.set(occurrence,event);groups.set(event.seriesId,group);}
    for(const group of groups.values()){const master=group.master,schedule=CalendarImport.recurrence(Date.parse(master.start),master.rule,master.tzid,!!master.allDay),duration=Date.parse(master.end)-Date.parse(master.start),missing=[],overrides=[],local=instant=>master.allDay?dayStamp(instant):master.tzid?Zone.stamp(Zone.toWall(instant,master.tzid)):stamp(instant),dateParameter=master.allDay?';VALUE=DATE':master.tzid?';TZID='+master.tzid:'';for(const instant of schedule){const occurrence=new Date(instant).toISOString(),event=group.occurrences.get(occurrence);if(!event){missing.push(local(instant));continue;}if(event.start!==occurrence||Date.parse(event.end)!==instant+duration||event.title!==master.title||event.description!==master.description||event.remindMinutes!==master.remindMinutes)overrides.push({event,occurrence});}emit(master,master.uid,['RRULE:'+master.rule,...(missing.length?['EXDATE'+dateParameter+':'+missing.join(',')]:[])],master.tzid);for(const item of overrides)emit(item.event,master.uid,['RECURRENCE-ID'+dateParameter+':'+local(Date.parse(item.occurrence))]);if(master.tzid){const existing=zones.get(master.tzid)||{first:Infinity,last:-Infinity};existing.first=Math.min(existing.first,...schedule);existing.last=Math.max(existing.last,...schedule,Date.parse(master.end));zones.set(master.tzid,existing);}}
    for(const [zone,range]of zones)lines.push(...Zone.component(zone,range.first,range.last));
    lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';
  }
  function update(events,eventId,changes,scope='occurrence'){
    if(!['occurrence','series'].includes(scope))throw new Error('Invalid event edit scope.');
    const selected=events.find(event=>event.id===eventId);if(!selected)throw Object.assign(new Error('Event not found.'),{code:'NOT_FOUND'});
    const startDelta=changes.start===undefined?0:Date.parse(changes.start)-Date.parse(selected.start),endDelta=changes.end===undefined?0:Date.parse(changes.end)-Date.parse(selected.end);
    if(!Number.isFinite(startDelta)||!Number.isFinite(endDelta))throw new Error('Invalid event time.');
    let recurringMaster=null;if(scope==='series'&&selected.icalSeries){const meta=CalendarImport.validSeries(selected.icalSeries),{occurrence,...master}=meta;if(startDelta||endDelta){if(startDelta%1000||endDelta%1000||/\bUNTIL=/.test(master.rule))throw new Error('This recurring series cannot be shifted as a whole. Edit an occurrence instead.');const oldDates=CalendarImport.recurrence(Date.parse(master.start),master.rule,master.tzid,!!master.allDay),newDates=CalendarImport.recurrence(Date.parse(master.start)+startDelta,master.rule,master.tzid,!!master.allDay);if(oldDates.length!==newDates.length||oldDates.some((value,index)=>newDates[index]-value!==startDelta))throw new Error('This change would alter the recurrence pattern. Edit an occurrence instead.');master.start=new Date(Date.parse(master.start)+startDelta).toISOString();master.end=new Date(Date.parse(master.end)+endDelta).toISOString();}for(const key of ['title','description','remindMinutes'])if(changes[key]!==undefined)master[key]=changes[key];recurringMaster=master;}
    return events.map(event=>{
      if(event.id!==eventId&&!(scope==='series'&&selected.seriesId&&event.seriesId===selected.seriesId))return event;
      const next={...event};for(const key of ['title','description','remindMinutes'])if(changes[key]!==undefined)next[key]=changes[key];
      if(changes.start!==undefined)next.start=new Date(Date.parse(event.start)+startDelta).toISOString();
      if(changes.end!==undefined)next.end=new Date(Date.parse(event.end)+endDelta).toISOString();
      if(recurringMaster&&event.icalSeries)next.icalSeries={...recurringMaster,occurrence:new Date(Date.parse(event.icalSeries.occurrence)+startDelta).toISOString()};
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
