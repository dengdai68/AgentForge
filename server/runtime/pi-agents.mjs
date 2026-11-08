// Executed only by Pi's native extension loader, which supplies `typebox`.
// The backend materializes this file; it never imports native Pi dependencies.
import {Type} from 'typebox';
import {spawn} from 'node:child_process';
import {readFile,mkdir,appendFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';

export default async function(pi){
  const config=JSON.parse(await readFile(new URL('./pi-agents.json',import.meta.url),'utf8')),agents=config.agents;
  pi.registerTool({name:'agentforge_subagent',label:'独立子代理',description:'Invoke one selected plugin subagent in an independent native Pi session and wait for its result. '+agents.map(a=>`${a.name}: ${a.description}`).join('\n'),parameters:Type.Object({agent:Type.Union(agents.map(a=>Type.Literal(a.name))),task:Type.String({minLength:1,maxLength:100000})}),
    async execute(toolCallId,params,signal,onUpdate,ctx){
      const agent=agents.find(item=>item.name===params.agent);if(!agent)throw Error('Unknown selected subagent');if(signal?.aborted)throw Error('Subagent invocation cancelled');
      const directory=join(ctx.cwd,'.agentforge','pi-plugin-agent-sessions',randomUUID());await mkdir(directory,{recursive:true,mode:0o700});
      const tools=agent.toolNames.filter(tool=>!agent.deniedTools?.includes(tool));
      const args=['--mode','json','--print','--no-extensions','--no-skills','--no-prompt-templates','--no-mcp','--no-context-files','--no-approve','--session-dir',directory,'--system-prompt',agent.promptFile,...(tools.length?['--tools',tools.join(',')]:['--no-tools']),...(ctx.model?['--model',ctx.model.provider+'/'+ctx.model.id]:[]),...(pi.getThinkingLevel?.()?['--thinking',pi.getThinkingLevel()]:[])];
      const metadata=join(dirname(fileURLToPath(import.meta.url)),'pi-agent-invocations.jsonl');
      await appendFile(metadata,JSON.stringify({event:'started',toolCallId,agent:agent.name,directory,at:new Date().toISOString()})+'\n',{mode:0o600});
      if(signal?.aborted)throw Error('Subagent invocation cancelled');
      let final='',failure='',sessionId,settled=false,stderr='',buffer='',cancelled=false;
      const decoder=new StringDecoder('utf8'),child=spawn(config.command,args,{cwd:ctx.cwd,env:{...process.env,PWD:ctx.cwd},stdio:['pipe','pipe','pipe']});
      const cancel=()=>{cancelled=true;child.kill('SIGTERM');};signal?.addEventListener('abort',cancel,{once:true});
      const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
      const event=value=>{
        if(value.type==='session')sessionId=value.id;
        if(value.type==='message_end'&&value.message?.role==='assistant'){
          if(['error','aborted'].includes(value.message.stopReason))failure=value.message.errorMessage || value.message.stopReason;
          const text=value.message.content?.filter(part=>part.type==='text').map(part=>part.text).join('\n');if(text)final=text;
        }
        if(value.type==='auto_retry_end'&&!value.success)failure=value.finalError || 'Native retry failed';
        if(value.type==='agent_settled'){settled=!value.aborted;if(value.aborted)failure='Native subagent aborted';}
        if(value.type==='tool_execution_start')onUpdate?.({content:[{type:'text',text:`${agent.sourceName}: ${value.toolName}`}],details:{agent:agent.name,status:'running'}});
      };
      try{
        child.stdout.on('data',chunk=>{buffer+=decoder.write(chunk);let end;while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.trim())try{event(JSON.parse(line));}catch(error){failure=error.message;child.kill('SIGTERM');}}if(Buffer.byteLength(buffer)>16*1024*1024){failure='Native subagent event exceeded 16 MiB';child.kill('SIGTERM');}});
        child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});child.stdin.on('error',()=>{});child.stdin.end(params.task);
        const code=await exited;buffer+=decoder.end();if(buffer.trim())try{event(JSON.parse(buffer));}catch{failure='Native subagent ended with an invalid event';}
        await appendFile(metadata,JSON.stringify({event:'ended',toolCallId,agent:agent.name,sessionId,code,at:new Date().toISOString()})+'\n',{mode:0o600});
        if(cancelled)throw Error('Native subagent cancelled');if(code!==0||failure||!settled||!sessionId||!final)throw Error(failure || stderr || 'Native subagent did not complete');
        return {content:[{type:'text',text:final}],details:{agent:agent.name,sessionId,status:'completed'}};
      }finally{signal?.removeEventListener('abort',cancel);if(child.exitCode===null)child.kill('SIGTERM');}
    }
  });
}
