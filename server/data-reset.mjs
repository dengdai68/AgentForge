import {lstat,open,readFile,rename,rm,mkdir,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute,parse,dirname} from 'node:path';
import {homedir} from 'node:os';

// A confirmed reset owns exactly the current work root. Its intent must survive
// deletion, so lives with private configuration, never inside the work root.
export function createDataReset({workspaceRoot,configurationRoot,protectedPaths=[]}){
  if(!workspaceRoot||!configurationRoot)throw new Error('清除操作需要工作目录和配置目录');
  const work=resolve(workspaceRoot),control=resolve(configurationRoot),journal=join(control,'data-reset.json'),pending=journal+'.pending';
  const protectedRoots=[resolve(homedir()),control,...protectedPaths.map(path=>resolve(path))];
  function safe(path){if(!isAbsolute(path)||path!==resolve(path)||path===parse(path).root||protectedRoots.some(root=>root===path||root.startsWith(path+'/'))||path.startsWith(control+'/'))throw new Error('清除目标包含受保护目录，未执行清除');}
  async function validate(){safe(work);const info=await lstat(work).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw new Error('工作目录必须是真实文件夹，未执行清除');if(info){const actual=await realpath(work);safe(actual);if(actual!==work)throw new Error('工作目录父路径包含链接，未执行清除');}const config=await lstat(control);if(!config.isDirectory()||config.isSymbolicLink())throw new Error('配置目录不可用');}
  async function privateFile(path){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>4096||(info.mode&0o077))throw new Error('数据清除记录无效');}
  return {
    async begin(){await validate();await mkdir(control,{recursive:true,mode:0o700});try{await lstat(journal);throw new Error('已有数据清除尚未完成，请重启后继续');}catch(error){if(error.code!=='ENOENT')throw error;}
      const fd=await open(pending,'wx',0o600);try{await fd.writeFile(JSON.stringify({version:1,workspaceRoot:work}));await fd.sync();}finally{await fd.close();}await rename(pending,journal);
    },
    async recover(){let plan;try{await privateFile(journal);plan=JSON.parse(await readFile(journal,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;try{await privateFile(pending);await rm(pending);}catch(error){if(error.code!=='ENOENT')throw error;}return false;}
      if(plan?.version!==1||plan.workspaceRoot!==work||Object.keys(plan).length!==2)throw new Error('数据清除记录归属无效');await validate();await rm(work,{recursive:true,force:true});await mkdir(work,{recursive:true,mode:0o700});await rm(journal);return true;
    }
  };
}
