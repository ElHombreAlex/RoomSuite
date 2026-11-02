'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DocAnnotations=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const maxAnchor=1000;
  function valid(anchor){return !!anchor&&typeof anchor==='object'&&!Array.isArray(anchor)&&Number.isSafeInteger(anchor.start)&&Number.isSafeInteger(anchor.end)&&anchor.start>=0&&anchor.end>anchor.start&&anchor.end<=6*1024*1024&&anchor.end-anchor.start<=maxAnchor&&typeof anchor.text==='string'&&anchor.text.length===anchor.end-anchor.start&&typeof anchor.orphaned==='boolean';}
  function attached(anchor,content){return valid(anchor)&&!anchor.orphaned&&anchor.end<=content.length&&content.slice(anchor.start,anchor.end)===anchor.text;}
  function difference(before,after,precise){if(typeof before!=='string'||typeof after!=='string')throw new Error('Document text is required.');let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;let tail=0;while(tail<before.length-start&&tail<after.length-start&&before[before.length-1-tail]===after[after.length-1-tail])tail++;let oldEnd=before.length-tail,newEnd=after.length-tail,ambiguousStart=start,exact=false;if(precise&&Number.isSafeInteger(precise.start)&&Number.isSafeInteger(precise.oldEnd)){const a=precise.start,b=precise.oldEnd,c=after.length-(before.length-b);if(a>=0&&b>=a&&b<=before.length&&c>=a&&c<=after.length&&before.slice(0,a)===after.slice(0,a)&&before.slice(b)===after.slice(c)){start=a;oldEnd=b;newEnd=c;ambiguousStart=start;exact=true;}}if(!exact&&before!==after){let left=start,old=oldEnd,next=newEnd;while(left>0&&old>0&&next>0&&before[old-1]===after[next-1]){left--;old--;next--;}ambiguousStart=left;}return {start,oldEnd,newEnd,ambiguousStart,exact,delta:after.length-before.length};}
  function rebase(comments,before,after,precise){const {start,oldEnd,newEnd,ambiguousStart,delta}=difference(before,after,precise),inserted=newEnd-start;
    return comments.map(comment=>{const anchor=comment.anchor;if(!anchor||anchor.orphaned)return comment;const orphan=()=>({...comment,anchor:{...anchor,orphaned:true}});if(!attached(anchor,before))return orphan();if(before===after)return comment;let a=anchor.start,b=anchor.end;
      if(ambiguousStart<start&&b>ambiguousStart&&a<oldEnd)return orphan();
      if(start===oldEnd){if(start<=a){a+=inserted;b+=inserted;}else if(start<b)b+=inserted;}
      else if(oldEnd<=a){a+=delta;b+=delta;}
      else if(start<b){if(start<=a&&oldEnd>=b)return orphan();const nextStart=a<start?a:newEnd,nextEnd=b>oldEnd?b+delta:start;a=nextStart;b=nextEnd;}
      if(a<0||b<=a||b-a>maxAnchor||b>after.length)return orphan();return {...comment,anchor:{start:a,end:b,text:after.slice(a,b),orphaned:false}};
    });}
  function orphan(comments){return comments.map(comment=>comment.anchor&&!comment.anchor.orphaned?{...comment,anchor:{...comment.anchor,orphaned:true}}:comment);}
  return {valid,attached,difference,rebase,orphan,maxAnchor};
});
