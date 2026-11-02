'use strict';

// Bound expensive browser render processes. Waiting requests can disconnect.
function createRenderQueue({concurrency=1,maxQueued=4}={}) {
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4||!Number.isInteger(maxQueued)||maxQueued<0||maxQueued>20)throw new Error('Invalid render queue limits.');
  let active=0;const waiting=[];
  const cancelled=()=>Object.assign(new Error('Render cancelled.'),{status:499});
  function dispatch(){
    while(active<concurrency&&waiting.length){
      const entry=waiting.shift();entry.signal?.removeEventListener('abort',entry.abort);
      if(entry.signal?.aborted){entry.reject(cancelled());continue;}
      active++;
      Promise.resolve().then(entry.job).then(entry.resolve,entry.reject).finally(()=>{active--;dispatch();});
    }
  }
  function run(job,{signal}={}){
    if(typeof job!=='function')return Promise.reject(new Error('A render job is required.'));
    if(signal?.aborted)return Promise.reject(cancelled());
    if(active>=concurrency&&waiting.length>=maxQueued)return Promise.reject(Object.assign(new Error('The render queue is full. Try again when another render finishes.'),{status:429}));
    return new Promise((resolve,reject)=>{
      const entry={job,signal,resolve,reject};entry.abort=()=>{const index=waiting.indexOf(entry);if(index>=0){waiting.splice(index,1);reject(cancelled());}};
      if(signal)signal.addEventListener('abort',entry.abort,{once:true});waiting.push(entry);dispatch();
    });
  }
  return {run,stats:()=>({active,waiting:waiting.length,concurrency,maxQueued})};
}
module.exports={createRenderQueue};
