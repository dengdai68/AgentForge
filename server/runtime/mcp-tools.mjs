import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { cliEnvironment } from './cli-environment.mjs';
import { diagnosticRedactor } from '../diagnostics.mjs';

// Use the same immutable configuration and launcher as actual Provider calls.
// Only initialize and tools/list are sent; discovery never calls a tool.
export function createMcpToolDiscovery({timeoutMs=15000,ttlMs=60000,clock=Date.now}={}) {
  const cache=new Map(),pending=new Map();let cacheBytes=0;
  return async function discover(reference,serviceName,{secrets=[],refresh=false}={}) {
    for(const [id,item] of cache)if(item.expires<=clock()){cache.delete(id);cacheBytes-=item.bytes;}
    const key=reference.id+':'+reference.sha256,previous=cache.get(key);
    if(!refresh && previous && previous.expires>clock())return structuredClone(previous.value);
    if(pending.has(key))return structuredClone(await pending.get(key));
    if(pending.size>=4)throw new Error('已有多个 MCP 正在读取工具，请稍后重试');
    const work=(async()=>{
      const redact=diagnosticRedactor({secrets:secrets.flatMap(value=>typeof value==='string' ? [value,value.replace(/^(?:Bearer|Basic)\s+/i,'')] : [])}),controller=new AbortController();
      const definition=value=>typeof value==='string' ? redact(value) : Array.isArray(value) ? value.map(definition) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,definition(item)])) : value;
      const timer=setTimeout(()=>controller.abort(new Error('MCP 工具读取超时，请检查服务与登录状态后重试')),timeoutMs);
      // A packaged backend runs inside Electron Helper. The host supplies the
      // main executable for Node children, as it does for the history bridge.
      const nodeExecutable=process.env.AGENTFORGE_ELECTRON_NODE || process.execPath;
      const transport=new StdioClientTransport({command:nodeExecutable,args:[fileURLToPath(new URL('./mcp-launcher.mjs',import.meta.url)),reference.path,reference.sha256,serviceName],env:{...cliEnvironment(nodeExecutable),ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe',maxBufferSize:4*1024*1024});
      transport.stderr?.resume();
      const client=new Client({name:'agentforge-tool-discovery',version:'1.0.0'},{capabilities:{}});
      try {
        await client.connect(transport,{signal:controller.signal,timeout:timeoutMs});
        const tools=[],names=new Set(),cursors=new Set();let cursor,bytes=2;
        if(client.getServerCapabilities()?.tools) do {
          const page=await client.listTools(cursor?{cursor}:{},{signal:controller.signal,timeout:timeoutMs});
          for(const tool of page.tools) {
            if(names.has(tool.name))throw new Error('MCP 返回重复的工具名称，无法确认工具清单');
            names.add(tool.name);const safe=definition({name:tool.name,...(tool.title?{title:tool.title}:{}),description:tool.description || '',inputSchema:tool.inputSchema,...(tool.outputSchema?{outputSchema:tool.outputSchema}:{}),...(tool.annotations?{annotations:tool.annotations}:{})});
            bytes+=Buffer.byteLength(JSON.stringify(safe))+(tools.length?1:0);tools.push(safe);
          }
          if(tools.length>2000 || bytes>2*1024*1024)throw new Error('MCP 工具清单超过读取上限（2000 项 / 2 MiB）');
          cursor=page.nextCursor;
          if(cursor && (cursors.has(cursor)||cursors.size>=100))throw new Error('MCP 工具分页游标重复或页数过多');
          if(cursor)cursors.add(cursor);
        }while(cursor);
        const value={tools,total:tools.length,checkedAt:new Date(clock()).toISOString()};
        if(cache.has(key)){cacheBytes-=cache.get(key).bytes;cache.delete(key);}
        while(cache.size>=64 || cacheBytes+bytes>16*1024*1024){const oldest=cache.keys().next().value;cacheBytes-=cache.get(oldest).bytes;cache.delete(oldest);}
        cache.set(key,{value,bytes,expires:clock()+ttlMs});cacheBytes+=bytes;return value;
      }catch(error){
        throw new Error(redact({message:controller.signal.aborted ? controller.signal.reason.message : `无法读取 MCP 工具：${error.message}`}).message);
      }finally{clearTimeout(timer);await client.close().catch(()=>{});await transport.close().catch(()=>{});}
    })();
    pending.set(key,work);
    try{return structuredClone(await work);}finally{pending.delete(key);}
  };
}
