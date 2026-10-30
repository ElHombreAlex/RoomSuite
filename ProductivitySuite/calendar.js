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
  return {ics};
});
