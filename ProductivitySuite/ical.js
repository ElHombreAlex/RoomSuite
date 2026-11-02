'use strict';
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./rrule'):root.CalendarRRule,typeof module==='object'&&module.exports?require('./timezone'):root.CalendarZone);if(typeof module==='object'&&module.exports)module.exports=api;else root.CalendarImport=api;})(typeof globalThis!=='undefined'?globalThis:this,function(RRule,Zone){
  const maxBytes=2*1024*1024,day=86400000,weekdays=['SU','MO','TU','WE','TH','FR','SA'];
  function text(value){let result='';for(let i=0;i<value.length;i++){if(value[i]!=='\\'){result+=value[i];continue;}const next=value[++i];if(next==='n'||next==='N')result+='\n';else if(next==='\\'||next===','||next===';')result+=next;else throw new Error('Invalid iCalendar text escape.');}return result;}
  function date(value,params={}){
    if(Object.keys(params).some(key=>!['VALUE','TZID'].includes(key))||(params.VALUE&&!['DATE','DATE-TIME'].includes(params.VALUE)))throw new Error('Only date-only, UTC or IANA time-zone date-time events are supported.');
    if(params.VALUE==='DATE'){
      if(params.TZID!==undefined)throw new Error('An all-day date cannot have a time zone.');
      const match=/^(\d{4})(\d\d)(\d\d)$/.exec(value);if(!match)throw new Error('Invalid all-day date.');
      const [y,m,d]=match.slice(1).map(Number),result=new Date(0);result.setUTCHours(0,0,0,0);result.setUTCFullYear(y,m-1,d);
      if(result.getUTCFullYear()!==y||result.getUTCMonth()!==m-1||result.getUTCDate()!==d)throw new Error('Invalid all-day date.');return result.getTime();
    }
    if(params.TZID!==undefined)return Zone.parseLocal(value,params.TZID);const match=/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(value);if(!match)throw new Error('Use a UTC date-time ending in Z or an IANA TZID.');const [y,m,d,h,min,s]=match.slice(1).map(Number),result=new Date(0);result.setUTCFullYear(y,m-1,d);result.setUTCHours(h,min,s,0);if(result.getUTCFullYear()!==y||result.getUTCMonth()!==m-1||result.getUTCDate()!==d||result.getUTCHours()!==h||result.getUTCMinutes()!==min||result.getUTCSeconds()!==s)throw new Error('Invalid iCalendar date-time.');return result.getTime();
  }
  function line(value){let quoted=false,split=-1;for(let i=0;i<value.length;i++){if(value[i]==='"')quoted=!quoted;if(value[i]===':'&&!quoted){split=i;break;}}if(split<1||quoted)throw new Error('Invalid iCalendar content line.');const header=value.slice(0,split).split(';'),name=header.shift().toUpperCase(),params={};if(!/^[A-Z0-9-]+$/.test(name))throw new Error('Invalid iCalendar property.');for(const parameter of header){const pos=parameter.indexOf('=');if(pos<1)throw new Error('Invalid iCalendar parameter.');const key=parameter.slice(0,pos).toUpperCase();if(params[key]!==undefined)throw new Error('Duplicate iCalendar parameter.');const value=parameter.slice(pos+1).replace(/^"|"$/g,'');params[key]=key==='VALUE'?value.toUpperCase():value;}return {name,params,value:value.slice(split+1)};}
  function one(properties,name,required=false){const list=properties.filter(item=>item.name===name);if(list.length>1||required&&!list.length)throw new Error('The event must have '+(required?'one ':'at most one ')+name+'.');return list[0];}
  function recurrence(start,value,tzid,allDay=false){const until=allDay?value=>date(value,{VALUE:'DATE'}):date;if(!tzid)return RRule.expand(start,value,until);if(allDay)throw new Error('An all-day recurrence cannot have a time zone.');const wall=Zone.toWall(start,tzid),year=new Date(wall).getUTCFullYear();if(year<1970||year>2100)throw new Error('Time-zone events support years 1970–2100.');return RRule.expand(wall,value,date,{zoned:true,expectedStart:start,map:candidate=>{const year=new Date(candidate).getUTCFullYear();if(year<1970||year>2100)throw new Error('Time-zone events support years 1970–2100.');return Zone.toInstant(candidate,tzid);}});}
  function validSeries(value,cache=new Map()){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['uid','rule','start','end','title','description','remindMinutes','occurrence','tzid','allDay'].includes(key)))throw new Error('Invalid recurring series.');const {uid,rule,start,end,title,description,remindMinutes,occurrence,tzid,allDay}=value,iso=input=>typeof input==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(input)&&Number.isFinite(Date.parse(input))&&new Date(input).toISOString()===input;if(typeof uid!=='string'||!uid.trim()||uid.length>255||/[\x00-\x1f\x7f]/.test(uid)||typeof rule!=='string'||rule.length>256||!iso(start)||!iso(end)||!iso(occurrence)||Date.parse(end)<=Date.parse(start)||typeof title!=='string'||!title.trim()||title.length>160||typeof description!=='string'||description.length>10000||(remindMinutes!==null&&(!Number.isInteger(remindMinutes)||remindMinutes<0||remindMinutes>10080))||(tzid!==undefined&&(typeof tzid!=='string'||!tzid))||(allDay!==undefined&&allDay!==true)||(allDay&&(tzid||![start,end,occurrence].every(value=>value.endsWith('T00:00:00.000Z')))))throw new Error('Invalid recurring series.');const key=JSON.stringify([start,rule.toUpperCase(),tzid||'',!!allDay]);let dates=cache.get(key);if(!dates){dates=new Set(recurrence(Date.parse(start),rule,tzid,!!allDay));cache.set(key,dates);}if(!dates.has(Date.parse(occurrence)))throw new Error('The occurrence is outside its recurrence rule.');return {uid,rule:rule.toUpperCase(),start,end,title,description,remindMinutes,occurrence,...(tzid?{tzid}:{}),...(allDay?{allDay:true}:{})};}
  function series(input,makeId){const master=validSeries({...input,occurrence:input.start}),dates=recurrence(Date.parse(master.start),master.rule,master.tzid,!!master.allDay),seriesId=makeId(),duration=Date.parse(master.end)-Date.parse(master.start);return dates.map(instant=>({id:makeId(),title:master.title,start:new Date(instant).toISOString(),end:new Date(instant+duration).toISOString(),description:master.description,remindMinutes:master.remindMinutes,...(master.allDay?{allDay:true}:{}),seriesId,icalUid:master.uid,icalSeries:{...master,occurrence:new Date(instant).toISOString()}}));}
  function alarm(components,warnings){if(!components.length)return null;if(components.length>1)warnings.add('Only the first supported display reminder was imported.');for(const properties of components){const action=one(properties,'ACTION'),trigger=one(properties,'TRIGGER');if(action?.value.toUpperCase()!=='DISPLAY'||!trigger||Object.keys(trigger.params).length){warnings.add('Some reminders were not imported.');continue;}const match=/^-(?:P(\d+)W|P(\d+)D|PT(\d+)H|PT(\d+)M)$/i.exec(trigger.value);if(!match){warnings.add('Some reminders were not imported.');continue;}const minutes=Number(match[1]||0)*10080+Number(match[2]||0)*1440+Number(match[3]||0)*60+Number(match[4]||0);if(!Number.isSafeInteger(minutes)||minutes>10080){warnings.add('Some reminders were not imported.');continue;}return minutes;}return null;}
  function parse(input,makeId){
    if(typeof input!=='string'||new TextEncoder().encode(input).length>maxBytes)throw new Error('iCalendar files must be UTF-8 and at most 2 MiB.');
    const lines=input.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\n[ \t]/g,'').split('\n');
    if(lines.length>50000||lines.some(item=>item.length>65536))throw new Error('The iCalendar file is too complex.');
    const stack=[],events=[],warnings=new Set();let current=null,currentAlarm=null,calendarCount=0,version=null;
    for(const raw of lines){
      if(!raw)continue;const item=line(raw),value=item.value.toUpperCase();
      if(item.name==='BEGIN'){
        if(value==='VCALENDAR'){if(stack.length||++calendarCount!==1)throw new Error('Invalid VCALENDAR.');}
        else if(value==='VEVENT'){if(stack.at(-1)!=='VCALENDAR'||current)throw new Error('Invalid VEVENT.');current={properties:[],alarms:[]};}
        else if(value==='VALARM'){if(stack.at(-1)!=='VEVENT'||!current)throw new Error('Invalid VALARM.');currentAlarm=[];current.alarms.push(currentAlarm);}
        else if(current)throw new Error('Unsupported nested event component.');
        else warnings.add('Embedded calendar components such as time-zone definitions were not imported; supported IANA zones use this device’s rules.');
        stack.push(value);continue;
      }
      if(item.name==='END'){
        if(stack.pop()!==value)throw new Error('Mismatched iCalendar component.');
        if(value==='VALARM')currentAlarm=null;
        if(value==='VEVENT'){events.push(current);current=null;if(events.length>1000)throw new Error('The iCalendar file has too many events.');}
        continue;
      }
      if(!stack.length)throw new Error('Properties must be inside VCALENDAR.');
      if(currentAlarm)currentAlarm.push(item);
      else if(current&&stack.at(-1)==='VEVENT')current.properties.push(item);
      else if(stack.at(-1)==='VCALENDAR'&&item.name==='VERSION'){if(version!==null)throw new Error('Duplicate calendar version.');version=item.value;}
    }
    if(stack.length||calendarCount!==1||version!=='2.0')throw new Error('An iCalendar version 2.0 file is required.');
    const groups=new Map();
    for(const event of events){
      const props=event.properties;
      if(props.some(item=>['RDATE','EXRULE','DURATION'].includes(item.name)))throw new Error('RDATE, EXRULE and DURATION are not supported.');
      const uid=text(one(props,'UID',true).value),rid=one(props,'RECURRENCE-ID'),status=one(props,'STATUS');
      if(!uid.trim()||uid.length>255||/[\x00-\x1f\x7f]/.test(uid))throw new Error('Every event needs a valid UID of at most 255 characters.');
      const recurrenceId=rid?date(rid.value,rid.params):null,cancelled=status?.value.toUpperCase()==='CANCELLED';
      if(status&&!cancelled)warnings.add('Event status is not retained.');
      const rule=one(props,'RRULE'),exceptions=props.filter(item=>item.name==='EXDATE');
      if(rule&&Object.keys(rule.params).length)throw new Error('Recurrence rule parameters are not supported.');
      if(recurrenceId!==null&&(rule||exceptions.length))throw new Error('A recurrence override cannot contain another rule or exceptions.');
      let details={uid,recurrenceId,cancelled,rule:rule?.value.toUpperCase(),recurrenceIsDate:rid?.params.VALUE==='DATE',exceptionKinds:exceptions.map(item=>item.params.VALUE==='DATE'),excluded:exceptions.flatMap(item=>item.value.split(',').map(value=>date(value,item.params)))};
      if(!cancelled){
        const startProperty=one(props,'DTSTART',true),endProperty=one(props,'DTEND'),allDay=startProperty.params.VALUE==='DATE',start=date(startProperty.value,startProperty.params);
        if(endProperty&&(endProperty.params.VALUE==='DATE')!==allDay)throw new Error('Event start and end must use the same date type.');
        if(!endProperty&&!allDay)throw new Error('Timed events require DTEND.');const end=endProperty?date(endProperty.value,endProperty.params):start+day;
        if(end<=start)throw new Error('Event end must be after its start.');
        const summary=one(props,'SUMMARY'),description=one(props,'DESCRIPTION'),title=summary?text(summary.value):'Untitled event',descriptionText=description?text(description.value):'';
        if(!title.trim()||title.length>160||descriptionText.length>10000)throw new Error('An event title or description exceeds PlanSuite limits.');
        details={...details,start,end,title,description:descriptionText,remindMinutes:alarm(event.alarms,warnings),...(startProperty.params.TZID?{tzid:startProperty.params.TZID}:{}),...(allDay?{allDay:true}:{})};
      }
      if(props.some(item=>!['UID','DTSTART','DTEND','SUMMARY','DESCRIPTION','RRULE','EXDATE','RECURRENCE-ID','STATUS','DTSTAMP','CREATED','LAST-MODIFIED','SEQUENCE'].includes(item.name)))warnings.add('Some event fields, such as locations or attendees, were not imported.');
      const group=groups.get(uid)||{master:null,overrides:new Map()};
      if(recurrenceId===null){if(group.master)throw new Error('Duplicate event UID without a recurrence ID.');group.master=details;}
      else{if(group.overrides.has(recurrenceId))throw new Error('Duplicate recurrence override.');group.overrides.set(recurrenceId,details);}
      groups.set(uid,group);
    }
    const output=[];
    for(const [uid,group]of groups){
      const master=group.master;if(!master)throw new Error('A recurrence override is missing its main event.');
      if(master.cancelled){warnings.add('Cancelled events were not imported.');continue;}
      if(!master.rule&&(master.excluded.length||group.overrides.size))throw new Error('Recurrence exceptions need a supported recurrence rule.');
      if(master.exceptionKinds.some(kind=>kind!==!!master.allDay)||[...group.overrides.values()].some(item=>item.recurrenceIsDate!==!!master.allDay||!item.cancelled&&!!item.allDay!==!!master.allDay))throw new Error('Recurrence dates must use the same date type as the event.');
      const starts=master.rule?recurrence(master.start,master.rule,master.tzid,!!master.allDay):[master.start],schedule=new Set(starts),excluded=new Set(master.excluded);
      if(excluded.size!==master.excluded.length||[...excluded].some(value=>!schedule.has(value)))throw new Error('An exception is outside its recurrence rule.');
      if([...group.overrides.keys()].some(value=>!schedule.has(value)||excluded.has(value)))throw new Error('A recurrence override is outside its rule or conflicts with an exception.');
      const seriesId=master.rule?makeId():null,base=master.rule?{uid,rule:master.rule,start:new Date(master.start).toISOString(),end:new Date(master.end).toISOString(),title:master.title,description:master.description,remindMinutes:master.remindMinutes,...(master.tzid?{tzid:master.tzid}:{}),...(master.allDay?{allDay:true}:{})}:null,duration=master.end-master.start;
      for(const instant of starts){
        if(excluded.has(instant))continue;const override=group.overrides.get(instant);if(override?.cancelled)continue;
        const selected=override||master,eventStart=override?override.start:instant,eventEnd=override?override.end:instant+duration;
        output.push({id:makeId(),title:selected.title,start:new Date(eventStart).toISOString(),end:new Date(eventEnd).toISOString(),description:selected.description,remindMinutes:selected.remindMinutes,icalUid:uid,...(master.allDay?{allDay:true}:{}),...(seriesId?{seriesId,icalSeries:{...base,occurrence:new Date(instant).toISOString()}}:{})});
        if(output.length>5000)throw new Error('The iCalendar file expands to more than 5,000 events.');
      }
    }
    return {events:output,warnings:[...warnings]};
  }
  function merge(existing,imported){const present=new Set(existing.map(event=>event.icalUid).filter(Boolean)),skipped=new Set(),events=[];for(const event of imported){if(present.has(event.icalUid))skipped.add(event.icalUid);else events.push(event);}if(existing.length+events.length>5000)throw new Error('The calendar would exceed 5,000 events.');return {events:[...existing,...events],added:events.length,skipped:skipped.size};}
  return {parse,merge,recurrence,validSeries,series,maxBytes};
});
