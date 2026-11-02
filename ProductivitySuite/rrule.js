'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CalendarRRule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const day=86400000,weekdays=['SU','MO','TU','WE','TH','FR','SA'];
  function utc(year,month,date=1){const value=new Date(0);value.setUTCHours(0,0,0,0);value.setUTCFullYear(year,month,date);return value.getTime();}
  function integerList(value,label,min,max,nonzero=false){const parts=value.split(',');if(!parts.length||parts.some(part=>!/^[-+]?\d+$/.test(part)))throw new Error('Invalid recurrence '+label+'.');const list=parts.map(Number);if(list.some(number=>!Number.isSafeInteger(number)||number<min||number>max||nonzero&&number===0)||new Set(list).size!==list.length)throw new Error('Invalid recurrence '+label+'.');return list;}
  function parse(value,parseUntil){
    if(typeof value!=='string'||value.length>256)throw new Error('Invalid recurrence rule.');const parts={};for(const part of value.split(';')){const [rawKey,rawValue,...extra]=part.split('='),key=rawKey?.toUpperCase();if(!key||!rawValue||extra.length||parts[key]!==undefined)throw new Error('Invalid recurrence rule.');parts[key]=rawValue.toUpperCase();}
    if(Object.keys(parts).some(key=>!['FREQ','INTERVAL','COUNT','UNTIL','BYDAY','BYMONTHDAY','BYMONTH','BYSETPOS','WKST'].includes(key)))throw new Error('This recurrence rule uses an unsupported option.');
    if(!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(parts.FREQ))throw new Error('Unsupported recurrence frequency.');if(parts.COUNT&&parts.UNTIL)throw new Error('A recurrence cannot specify both COUNT and UNTIL.');if(!parts.COUNT&&!parts.UNTIL)throw new Error('Import requires a finite recurrence with COUNT or UNTIL.');
    const single=(value,label,max)=>{if(!/^\d+$/.test(value||'')||Number(value)<1||Number(value)>max)throw new Error('Invalid recurrence '+label+'.');return Number(value);};
    const interval=parts.INTERVAL?single(parts.INTERVAL,'interval',52):1,count=parts.COUNT?single(parts.COUNT,'count',52):null,until=parts.UNTIL?parseUntil(parts.UNTIL):null,wkst=parts.WKST||'MO';if(!weekdays.includes(wkst))throw new Error('Invalid recurrence week start.');
    const months=parts.BYMONTH?integerList(parts.BYMONTH,'BYMONTH',1,12):null,monthDays=parts.BYMONTHDAY?integerList(parts.BYMONTHDAY,'BYMONTHDAY',-31,31,true):null,positions=parts.BYSETPOS?integerList(parts.BYSETPOS,'BYSETPOS',-366,366,true):null;
    if(monthDays&&parts.FREQ==='WEEKLY')throw new Error('BYMONTHDAY cannot be used with weekly recurrence.');if(positions&&!parts.BYMONTH&&!parts.BYMONTHDAY&&!parts.BYDAY)throw new Error('BYSETPOS requires a BYMONTH, BYMONTHDAY or BYDAY rule.');
    let days=null;if(parts.BYDAY){const tokens=parts.BYDAY.split(',');if(new Set(tokens).size!==tokens.length)throw new Error('Invalid recurrence BYDAY.');days=tokens.map(token=>{const match=/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token);if(!match)throw new Error('Invalid recurrence BYDAY.');const ordinal=match[1]===undefined?null:Number(match[1]);if(ordinal!==null&&(!ordinal||Math.abs(ordinal)>53||!['MONTHLY','YEARLY'].includes(parts.FREQ)))throw new Error('Invalid recurrence BYDAY ordinal.');return {weekday:weekdays.indexOf(match[2]),ordinal};});}
    return {frequency:parts.FREQ,interval,count,until,wkst:weekdays.indexOf(wkst),months,monthDays,positions,days};
  }
  function matchesDay(instant,rule,first){
    const date=new Date(instant),year=date.getUTCFullYear(),month=date.getUTCMonth(),dayOfMonth=date.getUTCDate(),weekday=date.getUTCDay(),daysInMonth=(utc(year,month+1,1)-utc(year,month,1))/day;
    if(rule.months&&!rule.months.includes(month+1))return false;
    if(rule.monthDays&&!rule.monthDays.some(value=>value>0?dayOfMonth===value:dayOfMonth===daysInMonth+value+1))return false;
    if(rule.days&&!rule.days.some(value=>{if(value.weekday!==weekday)return false;if(value.ordinal===null)return true;const scopeYear=rule.frequency==='YEARLY'&&!rule.months,start=scopeYear?utc(year,0,1):utc(year,month,1),end=scopeYear?utc(year+1,0,1):utc(year,month+1,1),fromStart=Math.floor((instant-start)/day),fromEnd=Math.floor((end-instant)/day)-1,ordinal=value.ordinal>0?Math.floor(fromStart/7)+1:-(Math.floor(fromEnd/7)+1);return ordinal===value.ordinal;}))return false;
    if(rule.frequency==='WEEKLY'&&!rule.days&&weekday!==first.getUTCDay())return false;
    if(rule.frequency==='MONTHLY'&&!rule.days&&!rule.monthDays&&dayOfMonth!==first.getUTCDate())return false;
    if(rule.frequency==='YEARLY'&&!rule.days&&!rule.monthDays&&(dayOfMonth!==first.getUTCDate()||!rule.months&&month!==first.getUTCMonth()))return false;
    return true;
  }
  function expand(start,value,parseUntil,{map=instant=>instant,expectedStart=start,zoned=false}={}){
    if(!Number.isFinite(start)||!Number.isFinite(expectedStart))throw new Error('Invalid recurrence start.');const rule=parse(value,parseUntil);if(rule.until!==null&&rule.until<expectedStart)throw new Error('Recurrence UNTIL precedes its start.');const first=new Date(start),firstDay=utc(first.getUTCFullYear(),first.getUTCMonth(),first.getUTCDate()),time=start-firstDay,weekStart=firstDay-((first.getUTCDay()-rule.wkst+7)%7)*day,result=[];let scanned=0;
    for(let period=0;period<25000;period++){
      let beginning,end;if(rule.frequency==='DAILY'){beginning=firstDay+period*rule.interval*day;end=beginning+day;}else if(rule.frequency==='WEEKLY'){beginning=weekStart+period*rule.interval*7*day;end=beginning+7*day;}else if(rule.frequency==='MONTHLY'){beginning=utc(first.getUTCFullYear(),first.getUTCMonth()+period*rule.interval,1);const d=new Date(beginning);end=utc(d.getUTCFullYear(),d.getUTCMonth()+1,1);}else{beginning=utc(first.getUTCFullYear()+period*rule.interval,0,1);end=utc(first.getUTCFullYear()+period*rule.interval+1,0,1);}
      if(!Number.isFinite(beginning))throw new Error('The recurrence exceeds supported dates.');if(rule.until!==null&&beginning+time>rule.until+(zoned?2*day:0))break;if(new Date(beginning).getUTCFullYear()>9999)throw new Error('The recurrence exceeds supported dates.');
      let candidates=[];for(let instant=beginning;instant<end;instant+=day){if(++scanned>250000)throw new Error('The recurrence is too large to import.');if(matchesDay(instant,rule,first))candidates.push(instant+time);}
      if(rule.positions){const selected=new Set();for(const position of rule.positions){const index=position>0?position-1:candidates.length+position;if(index>=0&&index<candidates.length)selected.add(candidates[index]);}candidates=[...selected].sort((a,b)=>a-b);}
      for(const candidate of candidates){if(candidate<start)continue;const instant=map(candidate);if(instant===null)continue;if(!Number.isFinite(instant))throw new Error('Invalid recurrence date.');if(rule.until!==null&&instant>rule.until)continue;result.push(instant);if(result.length>52)throw new Error('A recurrence can contain at most 52 events.');if(rule.count&&result.length===rule.count){if(result[0]!==expectedStart)throw new Error('The event start must match its recurrence rule.');return result;}}
    }
    if(rule.count&&result.length<rule.count)throw new Error('The recurrence is too large to import.');if(!result.length||result[0]!==expectedStart)throw new Error('The event start must match its recurrence rule.');return result;
  }
  return {expand};
});
