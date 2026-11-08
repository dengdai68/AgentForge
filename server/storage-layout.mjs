import {readFile,open,mkdir,rename,unlink,lstat,chmod,realpath,statfs} from 'node:fs/promises';
import {isAbsolute,join,resolve,dirname,parse,relative,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

export function storageBusinessRoot(workspaceRoot,instance='desktop') {
  assertStorageRoot(workspaceRoot);
  if(!['desktop','desktop-dev'].includes(instance))throw new Error('实例类型无效');
  return join(resolve(workspaceRoot),'records');
}
export function assertStorageRoot(path) {
  if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0')||path.length>4096||resolve(path)===parse(path).root)throw new Error('数据根目录必须是非文件系统根的绝对路径');
  return resolve(path);
}
export function storageLocation(value) {
  if(value && typeof value==='object' && Object.hasOwn(value,'businessRoot'))throw new Error('storage.json 不再接受 businessRoot；记录目录由 workspaceRoot/records 推导，请整理定位配置后重启');
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['version','workspaceRoot','previousRuntimeRoots'].includes(k))||value.version!==1)throw new Error('数据位置配置无效，请检查 storage.json；未创建新实例');
  const workspaceRoot=assertStorageRoot(value.workspaceRoot),previousRuntimeRoots=value.previousRuntimeRoots??[];
  if(!Array.isArray(previousRuntimeRoots)||previousRuntimeRoots.length>128||previousRuntimeRoots.some(p=>typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p||!p.endsWith(sep+'runtime-configs')))throw new Error('受管扩展位置记录无效');
  return {version:1,workspaceRoot,previousRuntimeRoots:[...new Set(previousRuntimeRoots)]};
}
export async function readStorageLocation(controlRoot,fallback) {
  const path=join(controlRoot,'storage.json');
  try{
    const info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>65536||(info.mode&0o077)||(process.getuid&&info.uid!==process.getuid()))throw new Error('数据位置配置不是当前用户的私有常规文件');
    return storageLocation(JSON.parse(await readFile(path,'utf8')));
  }catch(error){if(error.code==='ENOENT')return storageLocation(fallback);throw error;}
}
export async function writeStorageLocation(controlRoot,value) {
  const location=storageLocation(value);await mkdir(controlRoot,{recursive:true,mode:0o700});
  const info=await lstat(controlRoot);if(!info.isDirectory()||info.isSymbolicLink()||(process.getuid&&info.uid!==process.getuid()))throw new Error('启动定位目录不可用');
  await chmod(controlRoot,0o700);
  const path=join(controlRoot,'storage.json'),temporary=join(controlRoot,'.storage-'+randomUUID()+'.tmp');
  try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(location));await file.sync();}finally{await file.close();}await rename(temporary,path);}finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return location;
}
export function runtimeStoragePath(path,{currentRoot=process.env.AGENTFORGE_RUNTIME_CONFIG_ROOT,previousRoots}={}) {
  if(typeof path!=='string'||!isAbsolute(path)||!currentRoot)return path;
  previousRoots??=JSON.parse(process.env.AGENTFORGE_RUNTIME_PREVIOUS_ROOTS||'[]');
  if(!Array.isArray(previousRoots))throw new Error('受管扩展位置记录无效');
  for(const old of previousRoots){
    if(typeof old!=='string'||!isAbsolute(old))throw new Error('受管扩展位置记录无效');
    const part=relative(old,path);
    if(!part||(!part.startsWith('..'+sep)&&part!=='..'&&!isAbsolute(part)))return join(currentRoot,part);
  }
  return path;
}
export function runtimeStorageReferences(runtime,options) {
  if(!runtime)return runtime;
  const path=p=>runtimeStoragePath(p,options),ref=value=>({...value,...Object.fromEntries(['path','resourceRoot','sourceRoot'].filter(k=>typeof value[k]==='string').map(k=>[k,path(value[k])]))});
  return {...runtime,...Object.fromEntries(['skillPaths','pluginPaths','mcpConfigPaths'].filter(k=>Array.isArray(runtime[k])).map(k=>[k,runtime[k].map(path)])),...(runtime.extensionManifest?{extensionManifest:runtime.extensionManifest.map(ref)}:{})};
}

const within=(root,path)=>{const part=relative(root,path);return !part||(!part.startsWith('..'+sep)&&part!=='..'&&!isAbsolute(part));};
export async function validateStorageDestination({sourceRoot,workspaceRoot,instance='desktop',configurationRoot=null}){
  workspaceRoot=assertStorageRoot(workspaceRoot);sourceRoot=assertStorageRoot(sourceRoot);
  sourceRoot=await realpath(sourceRoot);
  await mkdir(workspaceRoot,{recursive:true,mode:0o700});workspaceRoot=await realpath(workspaceRoot);
  if(configurationRoot){const config=await realpath(configurationRoot);if(within(config,workspaceRoot)||within(workspaceRoot,config))throw new Error('工作目录不能覆盖或位于私有配置目录中');}
  const target=storageBusinessRoot(workspaceRoot,instance);
  if(target===sourceRoot)return {workspaceRoot,businessRoot:target,unchanged:true};
  if(within(sourceRoot,target)||within(target,sourceRoot))throw new Error('新旧数据位置不能相互嵌套');
  const privateInfo=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(privateInfo&&(!privateInfo.isDirectory()||privateInfo.isSymbolicLink()))throw new Error('目标私有目录必须是真实文件夹');
  if(await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))throw new Error('目标位置已有实例资料，请选择未占用的数据根目录');
  const free=await statfs(workspaceRoot);if(Number(free.bavail)*Number(free.bsize)<16*1024*1024)throw new Error('目标数据盘可用空间不足');
  return {workspaceRoot,businessRoot:target,unchanged:false};
}
