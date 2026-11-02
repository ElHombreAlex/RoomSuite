'use strict';
(() => {
  const wordNamespaces=new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main']);
  const attr=(node,name)=>node.getAttributeNS(node.namespaceURI,name)??node.getAttribute('w:'+name)??'';
  const word=node=>node.nodeType===Node.ELEMENT_NODE&&wordNamespaces.has(node.namespaceURI);
  function reconcile(html,comments){
    const text=new DOMParser().parseFromString(html,'text/html').body.textContent,warnings=[];let detached=0;
    const clean=(comments||[]).map(comment=>{if(!comment.anchor||DocAnnotations.attached(comment.anchor,text))return comment;const quote=comment.anchor.text,first=text.indexOf(quote);if(quote&&first>=0&&text.indexOf(quote,first+1)<0)return {...comment,anchor:{start:first,end:first+quote.length,text:quote,orphaned:false}};const copy={...comment};delete copy.anchor;detached++;return copy;});
    if(detached)warnings.push(detached+' Word comment anchor(s) could not be mapped safely and became general comments.');return {comments:clean,warnings};
  }
  async function read(zip,html,xml,textParagraphs){
    const entry=zip.file('word/comments.xml');if(!entry)return {comments:[],warnings:[]};
    const warnings=[],commentDoc=xml(await entry.async('string')),documentDoc=xml(await zip.file('word/document.xml').async('string')),starts=new Map(),ranges=new Map(),duplicates=new Set();let plain='';
    function walk(node){
      if(word(node)&&node.localName==='del')return;
      if(word(node)&&node.localName==='commentRangeStart'){const id=attr(node,'id');if(starts.has(id)||ranges.has(id))duplicates.add(id);else starts.set(id,plain.length);return;}
      if(word(node)&&node.localName==='commentRangeEnd'){const id=attr(node,'id');if(!starts.has(id)||ranges.has(id))duplicates.add(id);else ranges.set(id,[starts.get(id),plain.length]);return;}
      if(word(node)&&node.localName==='t'){plain+=node.textContent;return;}
      for(const child of node.childNodes||[])walk(child);
    }
    walk(documentDoc.documentElement);const htmlText=new DOMParser().parseFromString(html,'text/html').body.textContent,comments=[],ids=new Set();let omitted=0,unanchored=0;
    for(const node of [...commentDoc.getElementsByTagNameNS('*','comment')]){
      if(!word(node))continue;const id=attr(node,'id'),body=textParagraphs(node),author=attr(node,'author');
      if(!id||ids.has(id)||!body.trim()||body.length>10000||author.length>160||comments.length>=1000){omitted++;continue;}ids.add(id);
      const comment={id:crypto.randomUUID(),text:body,quote:'',author,resolved:false},range=!duplicates.has(id)&&ranges.get(id);if(range&&range[1]>range[0]){
        const quote=plain.slice(range[0],range[1]);if(quote.length<=1000){let start=plain===htmlText?range[0]:htmlText.indexOf(quote);if(start>=0&&(plain===htmlText||htmlText.indexOf(quote,start+1)<0)){comment.quote=quote;comment.anchor={start,end:start+quote.length,text:quote,orphaned:false};}}
      }
      if(!comment.anchor)unanchored++;comments.push(comment);
    }
    if(omitted)warnings.push(omitted+' Word comment(s) exceeded supported limits or were invalid and were omitted.');
    if(unanchored)warnings.push(unanchored+' Word comment(s) could not be linked safely and were imported as general comments.');
    if(zip.file('word/commentsExtended.xml'))warnings.push('Word comment threads and resolved status are imported as separate unresolved comments.');
    return {comments,warnings};
  }
  function prepare(parsed,comments,D){
    const nodes=[],offsets=new WeakMap(),events=new WeakMap(),walker=document.createTreeWalker(parsed.body,NodeFilter.SHOW_TEXT),bodyText=parsed.body.textContent;let node,offset=0;
    while((node=walker.nextNode())){const start=offset;offset+=node.data.length;if(!node.data.length)continue;const info={node,start,end:offset};nodes.push(info);offsets.set(node,info);}
    function locate(position,endBoundary){let low=0,high=nodes.length;while(low<high){const middle=(low+high)>>1;if(nodes[middle].end<position||!endBoundary&&nodes[middle].end===position)low=middle+1;else high=middle;}const found=nodes[low];return found&&(endBoundary?found.start<position:found.start<=position)?found:null;}
    const supported=[],warnings=[];let skipped=0,resolved=0;
    for(const comment of comments||[]){
      const anchor=comment?.anchor;if(!DocAnnotations.attached(anchor,bodyText)){skipped++;continue;}
      const first=locate(anchor.start,false),last=locate(anchor.end,true),block=item=>item?.node.parentElement?.closest('p,h1,h2,h3,li,td,th');
      if(!first||!last||!block(first)||block(first)!==block(last)||first.node.parentElement.closest('a')||last.node.parentElement.closest('a')||supported.some(item=>anchor.start<item.anchor.end&&anchor.end>item.anchor.start)){skipped++;continue;}
      const item={id:supported.length,anchor,comment,first,last};supported.push(item);if(comment.resolved)resolved++;
    }
    if(skipped)warnings.push('Some DocSuite comments were not included in Word ('+skipped+') because their text is unlinked, overlaps another comment, or crosses an unsupported boundary.');
    if(resolved)warnings.push('Word export keeps the comment text but not its resolved status.');
    const definitions=supported.map(({id,comment})=>({id,author:comment.author||'RoomSuite',initials:'RS',children:String(comment.text).split('\n').map(text=>new D.Paragraph({children:[new D.TextRun(text)]}))}));
    const eventMap=info=>{let value=events.get(info.node);if(!value){value={starts:new Map(),ends:new Map()};events.set(info.node,value);}return value;};
    for(const item of supported){const begin=eventMap(item.first).starts,end=eventMap(item.last).ends,a=item.anchor.start-item.first.start,b=item.anchor.end-item.last.start;begin.set(a,[...(begin.get(a)||[]),item.id]);end.set(b,[...(end.get(b)||[]),item.id]);}
    function textRuns(textNode,style){
      const info=offsets.get(textNode),event=events.get(textNode);if(!info||!event)return textNode.nodeValue?[new D.TextRun({...style,text:textNode.nodeValue})]:[];
      const {starts,ends}=event;
      const points=[...new Set([0,textNode.data.length,...starts.keys(),...ends.keys()])].sort((a,b)=>a-b),runs=[];
      for(let index=0;index<points.length;index++){const at=points[index];for(const id of ends.get(at)||[])runs.push(new D.CommentRangeEnd(id),new D.TextRun({children:[new D.CommentReference(id)]}));for(const id of starts.get(at)||[])runs.push(new D.CommentRangeStart(id));const next=points[index+1];if(next>at)runs.push(new D.TextRun({...style,text:textNode.data.slice(at,next)}));}return runs;
    }
    return {definitions,warnings,textRuns};
  }
  window.WordComments={read,prepare,reconcile};
})();
