'use strict';
(function (root, factory) {
  const model=factory();
  if (typeof module === 'object' && module.exports) module.exports=model;
  else root.GridModel=model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const column=n=>{let out='';for(n++;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
  function address(value){const match=/^([A-Z]{1,2})([1-9]\d{0,2})$/.exec(value);if(!match)throw new Error('#REF!');let col=0;for(const ch of match[1])col=col*26+ch.charCodeAt(0)-64;return {row:Number(match[2])-1,col:col-1};}
  function range(value,rows=500,columns=52){
    if(typeof value!=='string')throw new Error('Enter a cell range.');const parts=value.toUpperCase().split(':');if(parts.length>2)throw new Error('Use one row or column, such as A1:A5.');
    let a,b;try{a=address(parts[0]);b=address(parts[1]||parts[0]);}catch{throw new Error('Use a cell range such as A1:A5.');}
    if(a.row>=rows||b.row>=rows||a.col>=columns||b.col>=columns)throw new Error('The range is outside the spreadsheet.');
    if(a.row!==b.row&&a.col!==b.col)throw new Error('Use a single row or column for each chart range.');
    const result=[];for(let r=Math.min(a.row,b.row);r<=Math.max(a.row,b.row);r++)for(let c=Math.min(a.col,b.col);c<=Math.max(a.col,b.col);c++)result.push(column(c)+(r+1));
    if(result.length>30)throw new Error('Charts support up to 30 values.');return result;
  }
  function calculate(cells, rows=500, columns=52, types={}) {
    const cache=new Map(), active=new Set();
    function cell(name) {
      name=name.toUpperCase();const pos=address(name);if(pos.row>=rows || pos.col>=columns)throw new Error('#REF!');
      if(cache.has(name))return cache.get(name);if(active.has(name))throw new Error('#CYCLE!');if(active.size>=200)throw new Error('#DEPTH!');
      active.add(name);
      try {
        const raw=cells[name] || '';let result;
        if(types[name]==='error')throw new Error(raw);
        if(types[name]==='boolean')result=raw==='TRUE';
        else if(types[name]==='text'||types[name]==='date')result=raw;
        else if(raw.startsWith('='))result=parse(raw.slice(1));
        else if(!raw.trim())result=null;
        else if(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()))result=Number(raw);
        else result=raw;
        if(typeof result==='number'&&!Number.isFinite(result))throw new Error('#NUM!');
        cache.set(name,result);return result;
      } finally {active.delete(name);}
    }
    function parse(formula) {
      const tokens=[];let rest=formula;
      while(rest.length){const space=/^\s+/.exec(rest);if(space){rest=rest.slice(space[0].length);continue;}const m=/^"(?:[^"]|"")*"|^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|^[a-z]+[1-9]\d*|^[a-z]+|^(?:<=|>=|<>|[()+\-*/^,:<>=&%])/i.exec(rest);if(!m)throw new Error('#ERROR!');tokens.push(m[0].startsWith('"')?m[0]:m[0].toUpperCase());rest=rest.slice(m[0].length);if(tokens.length>10000)throw new Error('#ERROR!');}
      let i=0;const take=x=>tokens[i]===x?(i++,true):false;const number=x=>{if(x===null)return 0;if(typeof x==='boolean')return x?1:0;if(typeof x!=='number')throw new Error('#VALUE!');return x;};
      function atom(){
        if(take('(')){const v=expr();if(!take(')'))throw new Error('#ERROR!');return v;}
        const token=tokens[i++];if(!token)throw new Error('#ERROR!');
        if(token.startsWith('"')){const value=token.slice(1,-1).replaceAll('""','"');return ()=>value;}
        if(/^(?:\d|\.)/.test(token)){const value=Number(token);return ()=>value;}
        if(token==='TRUE')return ()=>true;if(token==='FALSE')return ()=>false;
        if(/^[A-Z]+[1-9]\d*$/.test(token)){
          if(!take(':'))return ()=>cell(token);
          const last=tokens[i++],a=address(token),b=address(last||'');if(a.row>=rows||b.row>=rows||a.col>=columns||b.col>=columns)throw new Error('#REF!');
          return ()=>{const result=[];for(let r=Math.min(a.row,b.row);r<=Math.max(a.row,b.row);r++)for(let c=Math.min(a.col,b.col);c<=Math.max(a.col,b.col);c++)result.push(cell(column(c)+(r+1)));return result;};
        }
        if(/^[A-Z]+$/.test(token)&&take('(')){
          const args=[];if(!take(')')){do{args.push(expr());}while(take(','));if(!take(')'))throw new Error('#ERROR!');}
          return ()=>{
            if(token==='IF'){if(args.length!==3)throw new Error('#ERROR!');return args[0]()?args[1]():args[2]();}
            if(token==='AND')return args.every(arg=>arg());if(token==='OR')return args.some(arg=>arg());
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
    return name=>{try{const value=cell(name);return value===null?'':typeof value==='number'?String(Number(value.toPrecision(12))):typeof value==='boolean'?(value?'TRUE':'FALSE'):value;}catch(error){return /^#/.test(error.message)?error.message:'#ERROR!';}};
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
  return {column,address,range,calculate,parseCsv,toCsv,sortRows};
});
