import Version from '../version.js';
import {serverUrl} from './rooms.mjs';
const startup=Version.snapshot();
export async function deploymentStatus(_args,signal){
  const origin=serverUrl(),response=await fetch(origin+'/api/version',{signal,cache:'no-store'});
  if(!response.ok)throw Object.assign(new Error('The backend does not expose the v2.1 deployment check. Restart or update it.'),{code:'VERSION_UNAVAILABLE'});
  const server=await response.json(),current=Version.snapshot(),issues=[];
  if(!server.startup?.backend||!server.current?.frontend||!server.startup?.mcp)throw Object.assign(new Error('The backend version response is incomplete.'),{code:'VERSION_UNAVAILABLE'});
  if(server.version!==startup.version||server.current.version!==server.version)issues.push('Backend and MCP release versions differ.');
  for(const component of ['backend','frontend','mcp']){
    if(server.startup[component].hash!==startup[component].hash)issues.push('The backend and MCP process started with different '+component+' files.');
    if(server.startup[component].hash!==server.current[component].hash)issues.push('The backend started before its '+component+' files changed.');
    if(startup[component].hash!==current[component].hash)issues.push('This MCP process started before its '+component+' files changed.');
  }
  const entries=Object.entries(server.startup.frontend.files),failed=[];let cursor=0;
  async function worker(){for(;;){const index=cursor++;if(index>=entries.length)return;const [route,expected]=entries[index];try{const r=await fetch(origin+route,{signal,cache:'no-store'});if(!r.ok||Version.hash(Buffer.from(await r.arrayBuffer()))!==expected)failed.push(route);}catch{failed.push(route);}}}
  await Promise.all(Array.from({length:Math.min(8,entries.length)},worker));
  if(failed.length)issues.push('Served frontend files differ from the backend startup snapshot: '+failed.sort().join(', '));
  return {ok:issues.length===0,version:startup.version,backend_version:server.version,checked_frontend_files:entries.length,issues,scope:'This connected MCP process, the running backend, and served HTML, CSS and JavaScript. Other agent processes must run this check separately.'};
}
