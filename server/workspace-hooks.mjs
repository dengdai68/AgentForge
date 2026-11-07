// Invocation-owned registration bridge. No caller-selected identity or filesystem path.
import http from 'node:http';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {diagnostic} from './diagnostics.mjs';

export async function withWorkspaceHooks(files, task, input, invoke) {
  const temporary = tmpdir();
  const prefix = Buffer.byteLength(join(temporary,'af-workspace-XXXXXX','s')) <= 96 ? join(temporary,'af-workspace-') : '/tmp/af-workspace-';
  const directory = await mkdtemp(prefix), socket = join(directory,'s');
  await chmod(directory,0o700);
  const scan = async () => {
    try { await files.registerWorkingRepositories(task); return true; }
    catch(error) { diagnostic('workspace.registration_failed',{error}); return false; }
  };
  let pending=null,dirty=false;
  const schedule=()=>{dirty=true;if(!pending)pending=(async()=>{let ok=true;do{dirty=false;ok=await scan()&&ok;}while(dirty);return ok;})().finally(()=>{pending=null;});return pending;};
  const server = http.createServer(async (request,response)=>{
    if (request.method!=='POST' || request.url!=='/register') { response.writeHead(404).end(); return; }
    request.resume();
    const ok = await schedule();
    response.writeHead(ok?204:503).end();
  });
  server.requestTimeout=10000;
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
    await chmod(socket,0o600);
    await scan();
    const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
    const executable=process.env.AGENTFORGE_ELECTRON_NODE || process.execPath;
    // The helper only sends a trigger; no tool inputs/outputs or secrets cross it.
    const command=(process.versions.electron?'ELECTRON_RUN_AS_NODE=1 ':'')+[executable,fileURLToPath(new URL('./workspace-hook-client.mjs',import.meta.url)),socket].map(quote).join(' ');
    return await invoke({...input,workspaceHook:{command,socket}});
  } finally {
    server.closeAllConnections();
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    await pending;
    await scan();
    await rm(directory,{recursive:true,force:true});
  }
}
