'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CalendarZone=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const day=86400000,formatters=new Map();
  function formatter(zone){if(typeof zone!=='string'||zone.length>100||!/^[-+A-Za-z0-9_\/]+$/.test(zone))throw new Error('Use a valid IANA time zone.');if(!formatters.has(zone))try{formatters.set(zone,new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));}catch{throw new Error('This IANA time zone is not available on this device.');}return formatters.get(zone);}
  function toWall(instant,zone){if(!Number.isFinite(instant))throw new Error('Invalid time-zone date.');const parts=Object.fromEntries(formatter(zone).formatToParts(new Date(instant)).filter(item=>item.type!=='literal').map(item=>[item.type,Number(item.value)]));return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);}
  function offset(instant,zone){const second=Math.floor(instant/1000)*1000;return toWall(second,zone)-second;}
  function toInstant(wall,zone){if(!Number.isFinite(wall))throw new Error('Invalid local date.');formatter(zone);const offsets=new Set();for(const delta of [-2,-1,0,1,2])offsets.add(offset(wall+delta*day,zone));const candidates=[...offsets].map(value=>wall-value).filter(value=>toWall(value,zone)===wall).sort((a,b)=>a-b);return candidates.length?candidates[0]:null;}
  function parseLocal(value,zone){const match=/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)$/.exec(value);if(!match)throw new Error('Use a local iCalendar date-time with a time zone.');const [year,month,date,hour,minute,second]=match.slice(1).map(Number);if(year<1970||year>2100)throw new Error('Time-zone events support years 1970–2100.');const wall=Date.UTC(year,month-1,date,hour,minute,second),check=new Date(wall);if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==date||check.getUTCHours()!==hour||check.getUTCMinutes()!==minute||check.getUTCSeconds()!==second)throw new Error('Invalid local date-time.');const instant=toInstant(wall,zone);if(instant===null)throw new Error('That local time does not exist because of a time-zone change.');return instant;}
  function stamp(wall){return new Date(wall).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'');}
  function offsetStamp(value){const sign=value<0?'-':'+',seconds=Math.abs(Math.round(value/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60,pad=n=>String(n).padStart(2,'0');return sign+pad(hours)+pad(minutes)+(rest?pad(rest):'');}
  function component(zone,first,last){
    formatter(zone);const a=new Date(first).getUTCFullYear(),b=new Date(last).getUTCFullYear();if(a<1970||b>2100||b<a)throw new Error('Time-zone events support years 1970–2100.');const start=Date.UTC(Math.max(1969,a-1),0,1),end=Date.UTC(Math.min(2102,b+2),0,1),groups=new Map();let previous=offset(start,zone);
    for(let current=start+day;current<=end;current+=day){const next=offset(current,zone);if(next!==previous){let low=current-day,high=current;while(high-low>1000){const middle=Math.floor((low+high)/2000)*1000;if(offset(middle,zone)===previous)low=middle;else high=middle;}const transition=high,kind=next>previous?'DAYLIGHT':'STANDARD',key=[kind,previous,next].join(':'),group=groups.get(key)||{kind,from:previous,to:next,dates:[]};group.dates.push(stamp(transition+previous));groups.set(key,group);}previous=next;}
    const lines=['BEGIN:VTIMEZONE','TZID:'+zone];if(!groups.size){const value=offset(first,zone);groups.set('fixed',{kind:'STANDARD',from:value,to:value,dates:[stamp(start+value)]});}
    for(const group of groups.values()){
      lines.push('BEGIN:'+group.kind,'DTSTART:'+group.dates[0],'TZOFFSETFROM:'+offsetStamp(group.from),'TZOFFSETTO:'+offsetStamp(group.to));
      // Some calendar parsers read only the first value of each RDATE and do
      // not include DTSTART when RDATE is present. Repeating the first date is
      // harmless in a recurrence set and keeps those parsers interoperable.
      if(group.dates.length>1)for(const date of group.dates)lines.push('RDATE:'+date);
      lines.push('END:'+group.kind);
    }lines.push('END:VTIMEZONE');return lines;
  }
  return {toWall,toInstant,parseLocal,stamp,component};
});
