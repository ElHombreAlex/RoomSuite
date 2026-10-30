import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {fileURLToPath} from 'node:url';
const client=new Client({name:'roomsuite-deployment-check',version:'2.1.1'});
try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))],env:process.env,stderr:'pipe'}));
  const result=await client.callTool({name:'roomsuite_check_deployment',arguments:{}},{timeout:120000});
  if(result.isError)throw new Error(result.content.map(item=>item.text||'').join(' '));
  console.log(JSON.stringify(result.structuredContent,null,2));
  if(!result.structuredContent?.ok)process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}finally{await client.close().catch(()=>{});}
