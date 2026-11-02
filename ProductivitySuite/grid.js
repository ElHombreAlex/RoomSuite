'use strict';
(function (root, factory) {
  const model=factory();
  if (typeof module === 'object' && module.exports) module.exports=model;
  else root.GridModel=model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const column=n=>{let out='';for(n++;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
  function address(value){const match=/^\$?([A-Z]{1,2})\$?([1-9]\d{0,2})$/.exec(value);if(!match)throw new Error('#REF!');let col=0;for(const ch of match[1])col=col*26+ch.charCodeAt(0)-64;return {row:Number(match[2])-1,col:col-1};}
  function range(value,rows=500,columns=52){
    if(typeof value!=='string')throw new Error('Enter a cell range.');const parts=value.toUpperCase().split(':');if(parts.length>2)throw new Error('Use one row or column, such as A1:A5.');
    let a,b;try{a=address(parts[0]);b=address(parts[1]||parts[0]);}catch{throw new Error('Use a cell range such as A1:A5.');}
    if(a.row>=rows||b.row>=rows||a.col>=columns||b.col>=columns)throw new Error('The range is outside the spreadsheet.');
    if(a.row!==b.row&&a.col!==b.col)throw new Error('Use a single row or column for each chart range.');
    const result=[];for(let r=Math.min(a.row,b.row);r<=Math.max(a.row,b.row);r++)for(let c=Math.min(a.col,b.col);c<=Math.max(a.col,b.col);c++)result.push(column(c)+(r+1));
    if(result.length>30)throw new Error('Charts support up to 30 values.');return result;
  }
  // Excel-style wildcard matching without constructing a user-supplied regex.
  function wildcard(text,pattern){
    const tokens=[];for(let i=0;i<pattern.length;i++){const c=pattern[i];if(c==='~'&&i+1<pattern.length&&'*?~'.includes(pattern[i+1]))tokens.push({literal:pattern[++i]});else if(c==='*'||c==='?')tokens.push({wild:c});else tokens.push({literal:c});}
    let i=0,j=0,star=-1,retry=0;while(i<text.length){const token=tokens[j];if(token&&(token.wild==='?'||token.literal===text[i])){i++;j++;}else if(token?.wild==='*'){star=j++;retry=i;}else if(star>=0){j=star+1;i=++retry;}else return false;}
    while(tokens[j]?.wild==='*')j++;return j===tokens.length;
  }
  function matchesCriterion(value,criterion){
    if(typeof criterion!=='string')return value===criterion;
    const match=/^(<=|>=|<>|=|<|>)(.*)$/s.exec(criterion),op=match?match[1]:'=',raw=match?match[2]:criterion;
    const isNumber=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()),expected=isNumber?Number(raw.trim()):raw.toLocaleLowerCase();
    if(value===null)value='';if(isNumber){if(typeof value!=='number')return op==='<>';}
    else value=String(value).toLocaleLowerCase();
    if(!isNumber&&(op==='='||op==='<>')){const equal=wildcard(value,expected);return op==='='?equal:!equal;}
    if(op==='=')return value===expected;if(op==='<>')return value!==expected;if(op==='<')return value<expected;if(op==='>')return value>expected;if(op==='<=')return value<=expected;return value>=expected;
  }
  function calculate(cells, rows=500, columns=52, types={}) {return calculateSheets([{id:'local',name:'Sheet',cells,rows,columns,types}], 'local');}
  function calculateWorkbook(workbook,sheetId=workbook.activeSheetId){
    const sheets=(workbook.sheets||[]).map(sheet=>sheet.id===workbook.activeSheetId?{...sheet,cells:workbook.cells,rows:workbook.rows,columns:workbook.columns,types:workbook.types||{}}:sheet);
    return calculateSheets(sheets,sheetId);
  }
  function renameSheet(workbook,sheetId,newName){
    const original=workbook.sheets.find(sheet=>sheet.id===sheetId);if(!original)throw new Error('Sheet not found.');
    const previous=original.name.toLowerCase(),quoted="'"+newName.replaceAll("'","''")+"'",pattern=/"(?:[^"]|"")*"|'(?:[^']|'')*'(?=\s*!)|[a-z_][a-z0-9_.]*(?=\s*!)/gi;
    const sheets=workbook.sheets.map(sheet=>{const active=sheet.id===workbook.activeSheetId,current=active?{...sheet,rows:workbook.rows,columns:workbook.columns,cells:workbook.cells,chart:workbook.chart,types:workbook.types||{},formats:workbook.formats||{},styles:workbook.styles||{},filter:workbook.filter||null}:sheet,cells={...current.cells};for(const [address,raw] of Object.entries(cells)){if(!raw.startsWith('=')||current.types?.[address]==='text')continue;cells[address]=raw.replace(pattern,token=>{if(token.startsWith('"'))return token;const name=token.startsWith("'")?token.slice(1,-1).replaceAll("''", "'"):token;return name.toLowerCase()===previous?quoted:token;});}return {...current,name:sheet.id===sheetId?newName:current.name,cells};});
    const active=sheets.find(sheet=>sheet.id===workbook.activeSheetId);return {...workbook,rows:active.rows,columns:active.columns,cells:active.cells,chart:active.chart,types:active.types,formats:active.formats,styles:active.styles,filter:active.filter,sheets};
  }
  function translateFormula(formula,rowDelta,colDelta,rows,columns){
    const token=/"(?:[^"]|"")*"|#(?:REF!|DIV\/0!|VALUE!|NAME\?|NUM!|CYCLE!|DEPTH!|ERROR!)|'(?:[^']|'')*'(?=\s*!)|[a-z_][a-z0-9_.]*(?=\s*!)|(?<![a-z0-9_.$])\$?[a-z]{1,2}\$?[1-9]\d{0,2}(?![a-z0-9_.])/gi;
    return formula.replace(token,(value,offset,whole)=>{if(value[0]==='"'||value[0]==="'"||value[0]==='#'||/^\s*!/.test(whole.slice(offset+value.length))||/^[a-z_][a-z0-9_.]*$/i.test(value)&&!/^\$?[a-z]{1,2}\$?[1-9]\d{0,2}$/i.test(value))return value;const match=/^(\$?)([a-z]{1,2})(\$?)([1-9]\d{0,2})$/i.exec(value);if(!match)return value;const pos=address(value.toUpperCase()),row=pos.row+(match[3]?0:rowDelta),col=pos.col+(match[1]?0:colDelta);if(row<0||row>=rows||col<0||col>=columns)return '#REF!';return match[1]+column(col)+match[3]+(row+1);});
  }
  function fill(sheet,source,destination,mode='copy'){
    if(!['copy','series'].includes(mode))throw new Error('Choose copy or series fill.');const anchor=address(source.toUpperCase()),parts=String(destination).toUpperCase().split(':');if(parts.length>2)throw new Error('Use a destination range such as A1:C5.');const a=address(parts[0]),b=address(parts[1]||parts[0]);
    if([anchor,a,b].some(pos=>pos.row>=sheet.rows||pos.col>=sheet.columns))throw new Error('The fill range is outside the spreadsheet.');const r0=Math.min(a.row,b.row),r1=Math.max(a.row,b.row),c0=Math.min(a.col,b.col),c1=Math.max(a.col,b.col),count=(r1-r0+1)*(c1-c0+1);if(count>1000)throw new Error('Fill at most 1000 cells at a time.');if(mode==='series'&&r0!==r1&&c0!==c1)throw new Error('A numeric series must fill a single row or column.');
    const key=column(anchor.col)+(anchor.row+1),raw=sheet.cells[key]||'',type=sheet.types?.[key],number=Number(raw);if(mode==='series'&&(type!==undefined||!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())||!Number.isFinite(number)))throw new Error('A numeric series needs a number in the source cell.');
    const cells={...sheet.cells},types={...sheet.types},formats={...sheet.formats},styles={...sheet.styles};
    for(let row=r0;row<=r1;row++)for(let col=c0;col<=c1;col++){const target=column(col)+(row+1),delta=mode==='series'?(r0===r1?col-anchor.col:row-anchor.row):0,value=mode==='series'?String(Number((number+delta).toPrecision(12))):raw.startsWith('=')&&type!=='text'?translateFormula(raw,row-anchor.row,col-anchor.col,500,52):raw;if(value.length>5000)throw new Error('A filled formula would exceed 5000 characters.');if(value)cells[target]=value;else delete cells[target];for(const [table,sourceTable,blankAllowed] of [[types,sheet.types,false],[formats,sheet.formats,false],[styles,sheet.styles,true]]){if((value||blankAllowed)&&sourceTable?.[key]!==undefined)table[target]=sourceTable[key];else delete table[target];}}
    return {...sheet,cells,types,formats,styles};
  }
  function calculateSheets(sheets,sheetId) {
    const selected=sheets.find(sheet=>sheet.id===sheetId),names=new Map(sheets.map(sheet=>[sheet.name.toLowerCase(),sheet]));if(!selected)throw new Error('Sheet not found.');
    function namedSheet(token){const name=token.startsWith("'")?token.slice(1,-1).replaceAll("''", "'"):token;const found=names.get(name.toLowerCase());if(!found)throw new Error('#REF!');return found;}
    const cache=new Map(), active=new Set();
    function cell(sheet,name) {
      name=name.toUpperCase();const pos=address(name);if(pos.row>=sheet.rows || pos.col>=sheet.columns)throw new Error('#REF!');name=name.replaceAll('$','');const key=sheet.id+'\0'+name;
      if(cache.has(key))return cache.get(key);if(active.has(key))throw new Error('#CYCLE!');if(active.size>=200)throw new Error('#DEPTH!');
      active.add(key);
      try {
        const raw=sheet.cells[name] || '',types=sheet.types||{};let result;
        if(types[name]==='error')throw new Error(raw);
        if(types[name]==='boolean')result=raw==='TRUE';
        else if(types[name]==='text'||types[name]==='date')result=raw;
        else if(raw.startsWith('='))result=parse(raw.slice(1),sheet);
        else if(!raw.trim())result=null;
        else if(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()))result=Number(raw);
        else result=raw;
        if(typeof result==='number'&&!Number.isFinite(result))throw new Error('#NUM!');
        cache.set(key,result);return result;
      } finally {active.delete(key);}
    }
    function parse(formula,currentSheet) {
      const tokens=[];let rest=formula;
      while(rest.length){const space=/^\s+/.exec(rest);if(space){rest=rest.slice(space[0].length);continue;}const m=/^"(?:[^"]|"")*"|^#(?:REF!|DIV\/0!|VALUE!|NAME\?|NUM!|CYCLE!|DEPTH!|ERROR!)|^'(?:[^']|'')*'(?=\s*!)|^[a-z_][a-z0-9_.]*(?=\s*!)|^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|^\$?[a-z]+\$?[1-9]\d*|^[a-z]+|^(?:<=|>=|<>|[!()+\-*/^,:<>=&%])/i.exec(rest);if(!m)throw new Error('#ERROR!');const sheetToken=/^\s*!/.test(rest.slice(m[0].length));tokens.push(m[0].startsWith('"')||sheetToken?m[0]:m[0].toUpperCase());rest=rest.slice(m[0].length);if(tokens.length>10000)throw new Error('#ERROR!');}
      let i=0;const take=x=>tokens[i]===x?(i++,true):false;const number=x=>{if(x===null)return 0;if(typeof x==='boolean')return x?1:0;if(typeof x!=='number')throw new Error('#VALUE!');return x;};
      function atom(){
        if(take('(')){const v=expr();if(!take(')'))throw new Error('#ERROR!');return v;}
        let token=tokens[i++],referenceSheet=()=>currentSheet;if(!token)throw new Error('#ERROR!');if(take('!')){const name=token;referenceSheet=()=>namedSheet(name);token=tokens[i++];if(!token||!/^\$?[A-Z]+\$?[1-9]\d*$/.test(token))throw new Error('#REF!');}
        if(token.startsWith('#'))return ()=>{throw new Error(token);};
        if(token.startsWith('"')){const value=token.slice(1,-1).replaceAll('""','"');return ()=>value;}
        if(/^(?:\d|\.)/.test(token)){const value=Number(token);return ()=>value;}
        if(token==='TRUE')return ()=>true;if(token==='FALSE')return ()=>false;
        if(/^\$?[A-Z]+\$?[1-9]\d*$/.test(token)){
          if(!take(':'))return ()=>cell(referenceSheet(),token);
          let last=tokens[i++],endSheet=null;if(take('!')){const name=last||'';endSheet=()=>namedSheet(name);last=tokens[i++];}const a=address(token),b=address(last||'');
          return ()=>{const sheet=referenceSheet();if(endSheet&&endSheet().id!==sheet.id)throw new Error('#REF!');if(a.row>=sheet.rows||b.row>=sheet.rows||a.col>=sheet.columns||b.col>=sheet.columns)throw new Error('#REF!');const result=[];for(let r=Math.min(a.row,b.row);r<=Math.max(a.row,b.row);r++)for(let c=Math.min(a.col,b.col);c<=Math.max(a.col,b.col);c++)result.push(cell(sheet,column(c)+(r+1)));result.rangeRows=Math.abs(a.row-b.row)+1;result.rangeColumns=Math.abs(a.col-b.col)+1;return result;};
        }
        if(/^[A-Z]+$/.test(token)&&take('(')){
          const args=[];if(!take(')')){do{args.push(expr());}while(take(','));if(!take(')'))throw new Error('#ERROR!');}
          return ()=>{
            if(token==='IF'){if(args.length!==3)throw new Error('#ERROR!');return args[0]()?args[1]():args[2]();}
            if(token==='AND')return args.every(arg=>arg());if(token==='OR')return args.some(arg=>arg());
            if(token==='SUMIF'){
              if(args.length<2||args.length>3)throw new Error('#ERROR!');const rangeValue=args[0](),criterion=args[1](),sumValue=args.length===3?args[2]():rangeValue;
              if(Array.isArray(criterion))throw new Error('#VALUE!');const checked=Array.isArray(rangeValue)?rangeValue:[rangeValue],summed=Array.isArray(sumValue)?sumValue:[sumValue];
              if(checked.length!==summed.length||(Array.isArray(rangeValue)&&Array.isArray(sumValue)&&(rangeValue.rangeRows!==sumValue.rangeRows||rangeValue.rangeColumns!==sumValue.rangeColumns)))throw new Error('#VALUE!');return checked.reduce((total,value,index)=>total+(matchesCriterion(value,criterion)&&typeof summed[index]==='number'?summed[index]:0),0);
            }
            const items=args.map(arg=>arg()).flat(),values=items.filter(value=>typeof value==='number');
            if(token==='COUNT')return values.length;if(token==='COUNTA')return items.filter(value=>value!==null).length;
            if(token==='SUM')return values.reduce((a,b)=>a+b,0);
            if(token==='AVERAGE'){if(!values.length)throw new Error('#DIV/0!');return values.reduce((a,b)=>a+b,0)/values.length;}
            if(token==='MIN')return values.length?Math.min(...values):0;if(token==='MAX')return values.length?Math.max(...values):0;
            if(token==='ABS'){if(items.length!==1)throw new Error('#ERROR!');return Math.abs(number(items[0]));}
            if(token==='ROUND'){if(items.length!==2)throw new Error('#ERROR!');const n=number(items[0]),digits=number(items[1]);if(!Number.isInteger(digits)||digits < -15||digits > 15)throw new Error('#NUM!');const factor=10**digits,scaled=Math.abs(n)*factor;return Math.sign(n)*Math.round(scaled+Number.EPSILON*Math.max(1,scaled)*2)/factor;}
            throw new Error('#NAME?');
          };
        }
        throw new Error('#ERROR!');
      }
      function unary(){if(take('+')){const v=unary();return ()=>number(v());}if(take('-')){const v=unary();return ()=>-number(v());}let v=atom();while(take('%')){const prior=v;v=()=>number(prior())/100;}return v;}
      function power(){let v=unary();if(take('^')){const prior=v,next=power();v=()=>Math.pow(number(prior()),number(next()));}return v;}
      function term(){let v=power();for(;;){if(take('*')){const prior=v,next=power();v=()=>number(prior())*number(next());}else if(take('/')){const prior=v,next=power();v=()=>{const n=number(next());if(n===0)throw new Error('#DIV/0!');return number(prior())/n;};}else return v;}}
      function addition(){let v=term();for(;;){if(take('+')){const prior=v,next=term();v=()=>number(prior())+number(next());}else if(take('-')){const prior=v,next=term();v=()=>number(prior())-number(next());}else return v;}}
      function concat(){let v=addition();while(take('&')){const prior=v,next=addition();v=()=>String(prior()??'')+String(next()??'');}return v;}
      function expr(){let v=concat();const op=tokens[i];if(['=','<>','<','>','<=','>='].includes(op)){i++;const prior=v,next=concat();v=()=>{let a=prior(),b=next();if(a===null)a=0;if(b===null)b=0;if(typeof a==='string'&&typeof b==='string'){a=a.toLocaleLowerCase();b=b.toLocaleLowerCase();}if(op==='=')return a===b;if(op==='<>')return a!==b;if(op==='<')return a<b;if(op==='>')return a>b;if(op==='<=')return a<=b;return a>=b;};}return v;}
      const run=expr();if(i!==tokens.length)throw new Error('#ERROR!');const value=run();if(Array.isArray(value))throw new Error('#ERROR!');return value;
    }
    return name=>{try{const value=cell(selected,name);return value===null?'':typeof value==='number'?String(Number(value.toPrecision(12))):typeof value==='boolean'?(value?'TRUE':'FALSE'):value;}catch(error){return /^#/.test(error.message)?error.message:'#ERROR!';}};
  }
  function parseCsv(source) {
    const rows=[], row=[];let value='',quoted=false,afterQuote=false;
    for(let i=0;i<source.length;i++){
      const c=source[i];
      if(quoted){if(c==='"'){if(source[i+1]==='"'){value+='"';i++;}else{quoted=false;afterQuote=true;}}else value+=c;continue;}
      if(afterQuote&&c!==','&&c!=='\r'&&c!=='\n')throw new Error('Invalid CSV after a quoted value.');
      if(c==='"'){if(value)throw new Error('Invalid quote in CSV.');quoted=true;}
      else if(c===','){row.push(value);value='';afterQuote=false;}
      else if(c==='\r'||c==='\n'){row.push(value);rows.push(row.splice(0));value='';afterQuote=false;if(c==='\r'&&source[i+1]==='\n')i++;}
      else value+=c;
    }
    if(quoted)throw new Error('Unclosed CSV quote.');if(value||row.length||afterQuote||!rows.length){row.push(value);rows.push(row);}
    return rows;
  }
  const toCsv=rows=>rows.map(row=>row.map(value=>{const s=String(value??'');return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}).join(',')).join('\r\n');
  function sortRows(cells,sortColumn,descending=false){
    if(!/^[A-Z]{1,2}$/.test(sortColumn))throw new Error('Choose a valid column.');
    if(Object.values(cells).some(value=>value.startsWith('=')))throw new Error('Sorting sheets with formulas is not supported because their references may change.');
    let last=1;for(const key of Object.keys(cells))last=Math.max(last,address(key).row+1);
    const rows=[];for(let r=2;r<=last;r++)rows.push({index:r,items:[],key:cells[sortColumn+r]||''});
    for(const [key,value] of Object.entries(cells)){const pos=address(key);if(pos.row>0)rows[pos.row-1].items.push([column(pos.col),value]);}
    const number=value=>/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())?Number(value):null;
    rows.sort((a,b)=>{if(!a.key&&!b.key)return a.index-b.index;if(!a.key)return 1;if(!b.key)return -1;const x=number(a.key),y=number(b.key),comparison=x!==null&&y!==null?x-y:a.key.localeCompare(b.key,undefined,{numeric:true,sensitivity:'base'});return (descending?-comparison:comparison)||a.index-b.index;});
    const result={};for(const [key,value] of Object.entries(cells))if(address(key).row===0)result[key]=value;
    rows.forEach((row,index)=>{for(const [col,value] of row.items)result[col+(index+2)]=value;});return result;
  }
  return {column,address,range,calculate,calculateWorkbook,renameSheet,fill,translateFormula,parseCsv,toCsv,sortRows};
});
