import {mkdir,lstat,readdir,readlink,readFile,writeFile,cp,rename,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,relative,dirname} from 'node:path';
import {assertStorageRoot,storageBusinessRoot,storageLocation,writeStorageLocation,validateStorageDestination} from '../../server/storage-layout.mjs';
import {pathToFileURL} from 'node:url';

const entries=['agentforge.sqlite','agentforge.sqlite-wal','agentforge.sqlite-shm','agentforge.sqlite.history.sqlite','agentforge.sqlite.history.sqlite-wal','agentforge.sqlite.history.sqlite-shm','runs','communications','.deleting'];
const cleanupName='.storage-relocation.json';
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function fingerprint(root,exclude=null){
  const records=[];
  async function walk(path){if(path===exclude)return;const info=await lstat(path),name=relative(root,path);
    if(info.isSymbolicLink()){records.push([name,'link',await readlink(path)]);return;}
    if(info.isDirectory()){records.push([name,'directory']);for(const name of(await readdir(path)).sort())await walk(join(path,name));return;}
    if(!info.isFile())throw new Error('存储目录中有不可搬运的特殊文件：'+path);
    const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);records.push([name,'file',info.size,hash.digest('hex')]);
  }
  await walk(root);return records;
}
// Caller must first stop its owned service with an exclusive idle lease. No
// Store/SQLite reads here: byte-identical copies preserve all domain facts.
export async function relocateStorage({sourceRoot,controlRoot,workspaceRoot,instance='desktop',previousRuntimeRoots=[],copy=cp,onProgress=()=>{}}){
  const target=await validateStorageDestination({sourceRoot,workspaceRoot,instance,configurationRoot:controlRoot});
  if(target.unchanged)return {location:storageLocation({version:1,workspaceRoot:target.workspaceRoot,previousRuntimeRoots}),cleanup:async()=>{}};
  const source=await lstat(sourceRoot);if(!source.isDirectory()||source.isSymbolicLink())throw new Error('源数据目录必须是真实文件夹');
  for(const name of ['data-reset.json','data-reset.json.pending','configuration.pending.json'])if(await exists(join(controlRoot,name)))throw new Error('实例有未结束的数据清理，请先完成恢复；未搬运资料');
  await mkdir(dirname(target.businessRoot),{recursive:true,mode:0o700});
  const staging=target.businessRoot+'.moving-'+randomUUID(),copied=[];await mkdir(staging,{mode:0o700});
  let committed=false;
  try{
    for(const name of entries){const from=join(sourceRoot,name),info=await exists(from);if(!info)continue;
      if(info.isSymbolicLink())throw new Error('受管存储根不能是符号链接：'+from);
      onProgress(name);const before=await fingerprint(from);
      await copy(from,join(staging,name),{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true,errorOnExist:true,force:false});
      if(JSON.stringify(before)!==JSON.stringify(await fingerprint(join(staging,name)))||JSON.stringify(before)!==JSON.stringify(await fingerprint(from)))throw new Error('搬运校验失败，源数据已变化或目标内容不一致：'+name);
      copied.push({name,fingerprint:before});
    }
    await writeFile(join(staging,cleanupName),JSON.stringify({version:1,sourceRoot:resolve(sourceRoot),entries:copied}),{mode:0o600,flag:'wx'});
    await rename(staging,target.businessRoot);
    const location=storageLocation({version:1,workspaceRoot:target.workspaceRoot,previousRuntimeRoots});
    await writeStorageLocation(controlRoot,location);committed=true;
    return {location,cleanup:()=>finishStorageRelocation({businessRoot:target.businessRoot})};
  }finally{if(!committed){await rm(staging,{recursive:true,force:true});/* A renamed, verified target is retained if locator commit failed. */}}
}

export async function finishStorageRelocation({businessRoot,previousRuntimeRoots=[]}){
  const journal=join(businessRoot,cleanupName),info=await exists(journal);if(!info)return false;
  if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024*1024||(info.mode&0o077))throw new Error('数据整理清理记录无效，保留旧资料');
  const plan=JSON.parse(await readFile(journal,'utf8'));
  if(plan.version!==1||typeof plan.sourceRoot!=='string'||plan.sourceRoot===businessRoot||assertStorageRoot(plan.sourceRoot)!==plan.sourceRoot||businessRoot.startsWith(plan.sourceRoot+'/')||plan.sourceRoot.startsWith(businessRoot+'/')||!Array.isArray(plan.entries)||plan.entries.some(item=>!entries.includes(item.name)||!Array.isArray(item.fingerprint)))throw new Error('数据整理来源不符，保留旧资料');
  // Validate the complete source before deleting the first entry. Target DB may
  // already contain new commits; the saved copy proof is the cleanup boundary.
  for(const item of plan.entries){const path=join(plan.sourceRoot,item.name);if(await exists(path)&&JSON.stringify(item.fingerprint)!==JSON.stringify(await fingerprint(path)))throw new Error('旧资料已被修改，保留原文件：'+item.name);}
  for(const item of plan.entries)await rm(join(plan.sourceRoot,item.name),{recursive:true,force:true});
  await rm(journal);return true;
}

// Explicit offline operator entry. Importing this module never starts a move.
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const args=process.argv.slice(2),flags={};
    for(let index=0;index<args.length;index++){
      const key=args[index];if(key==='--yes'){if(flags.yes)throw new Error('重复参数');flags.yes=true;continue;}
      if(!['--source','--control-root','--workspace-root','--instance'].includes(key)||flags[key]!==undefined||!args[index+1]||args[index+1].startsWith('--'))throw new Error('用法：--source 旧业务目录 --control-root 认证实例目录 --workspace-root 新数据根 [--instance desktop|desktop-dev] [--yes]');
      flags[key]=args[++index];
    }
    const sourceRoot=assertStorageRoot(flags['--source']),controlRoot=assertStorageRoot(flags['--control-root']),workspaceRoot=assertStorageRoot(flags['--workspace-root']),instance=flags['--instance']||'desktop';
    if(!flags.yes){console.log(JSON.stringify({sourceRoot,controlRoot,workspaceRoot,businessRoot:storageBusinessRoot(workspaceRoot,instance),execute:'显式添加 --yes；必须先退出此实例。'}));}
    else{
      let endpoint;try{const path=join(controlRoot,'desktop-endpoint.json'),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>1024)throw new Error('连接文件无效');endpoint=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(endpoint){if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.origin))throw new Error('连接地址无效');const health=await fetch(endpoint.origin+'/api/health',{redirect:'error',signal:AbortSignal.timeout(1500)}).catch(()=>null);if(health?.ok)throw new Error('本机服务仍在运行，请先退出此 AgentForge 实例；未搬运数据');}
      const previous=await readFile(join(controlRoot,'storage.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {previousRuntimeRoots:[]};throw error;});
      const result=await relocateStorage({sourceRoot,controlRoot,workspaceRoot,instance,previousRuntimeRoots:previous.previousRuntimeRoots||[]});
      console.log(JSON.stringify({location:result.location,sourcePreserved:true,next:'启动更新后的客户端；健康检查成功后自动完成旧资料清理。'}));
    }
  }catch(error){console.error(error.message);process.exitCode=1;}
}
