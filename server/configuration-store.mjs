import {mkdirSync,lstatSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

// Small configuration metadata only. Immutable extension bodies live in files;
// business bindings live in SQLite. A revision pointer coordinates their commit.
export const CONFIGURATION_COLLECTIONS = new Set(['extensionCatalog','extensionRemovals']);
export function configurationValues(state) {
  const result={};
  if(state.settings){const {installationId,...settings}=state.settings;result.settings=settings;}
  for(const key of CONFIGURATION_COLLECTIONS)if(Object.hasOwn(state,key))result[key]=state[key];
  return result;
}
export function createConfigurationStore({directory=null,databasePath=':memory:',committedRevision=null,publish=renameSync}={}) {
  const owner=databasePath===':memory:'?databasePath:resolve(databasePath);
  let document=null,candidate=null,fault=false,listing=null;
  const path=directory?join(directory,'configuration.json'):null,pending=directory?join(directory,'configuration.pending.json'):null;
  function syncDirectory(){if(!directory)return;const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
  function inspect(file){try {const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||(process.getuid&&info.uid!==process.getuid())||(info.mode&0o077)||info.size>32*1024*1024)throw new Error('配置清单必须是私有常规文件，且不超过 32 MiB');return info;}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  function read(file){if(!inspect(file))return null;let value;try{value=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('配置清单 JSON 无效；未初始化或覆盖配置');}if(value?.version!==1||typeof value.revision!=='string'||typeof value.owner!=='string'||!value.values||typeof value.values!=='object'||Array.isArray(value.values)||Object.keys(value).some(key=>!['version','revision','owner','values'].includes(key))||Object.keys(value.values).some(key=>!['settings',...CONFIGURATION_COLLECTIONS].includes(key))||Object.hasOwn(value.values,'settings')&&(!value.values.settings||typeof value.values.settings!=='object'||Array.isArray(value.values.settings))||[...CONFIGURATION_COLLECTIONS].some(key=>Object.hasOwn(value.values,key)&&!Array.isArray(value.values[key])))throw new Error('配置清单协议无效；未覆盖配置');return value;}
  if(directory){mkdirSync(directory,{recursive:true,mode:0o700});const info=lstatSync(directory);if(!info.isDirectory()||info.isSymbolicLink()||(process.getuid&&info.uid!==process.getuid()))throw new Error('配置目录必须是真实目录');document=read(path);candidate=read(pending);if(candidate){if(candidate.owner!==owner)throw new Error('另一个工作区有未结束的配置提交，请先恢复原工作区');if(candidate.revision===committedRevision){publish(pending,path);syncDirectory();document=candidate;}else unlinkSync(pending);candidate=null;}}
  let baseline=document?JSON.stringify(document.values):null;
  return {
    initialized(){return Boolean(document);},
    blocked(){return fault;},
    assertReady(){if(fault)throw new Error('配置发布尚未完成，请修复配置目录并重启后继续');},
    values(){return structuredClone(document?.values||{});},
    stage(values){
      if(fault)throw new Error('配置发布尚未完成，请修复配置目录并重启后继续');
      const serialized=JSON.stringify(values);if(serialized===baseline)return null;
      if(Buffer.byteLength(serialized)>32*1024*1024-1024)throw new Error('配置清单超过 32 MiB，未保存');
      candidate={version:1,revision:randomUUID(),owner,values:JSON.parse(serialized)};
      if(pending){
        let created=false;
        try{
          if(inspect(pending))throw new Error('配置提交尚未恢复，请重启');
          const fd=openSync(pending,'wx',0o600);created=true;
          try{writeFileSync(fd,JSON.stringify(candidate));fsyncSync(fd);}finally{closeSync(fd);}
          syncDirectory();
        }catch(error){candidate=null;if(created)try{unlinkSync(pending);}catch(cleanup){if(cleanup.code!=='ENOENT')throw new Error('配置候选清理未完成，请修复目录后重启',{cause:error});}throw error;}
      }
      return candidate.revision;
    },
    abort(){if(candidate&&pending)unlinkSync(pending);candidate=null;},
    commit(){if(!candidate)return;try{if(pending)publish(pending,path);syncDirectory();document=candidate;listing=null;baseline=JSON.stringify(candidate.values);candidate=null;}catch(cause){document=candidate;listing=null;fault=true;const error=new Error('配置与业务变更已提交，但配置文件发布未完成；请修复目录后重启恢复，不要重复提交',{cause});error.committed=true;throw error;}},
    query(kind,{search='',page=1,pageSize=20}={}){
      listing??=(document?.values.extensionCatalog||[]).filter(entry=>!entry.deletedAt).map(entry=>({entry,search:`${entry.name} ${entry.description||''}`.toLocaleLowerCase()})).sort((a,b)=>b.entry.createdAt.localeCompare(a.entry.createdAt)||a.entry.id.localeCompare(b.entry.id));
      const query=search.trim().toLocaleLowerCase(),rows=listing.filter(row=>row.entry.kind===kind&&row.search.includes(query));const total=rows.length,totalPages=Math.max(1,Math.ceil(total/pageSize));page=Math.min(page,totalPages);return {items:structuredClone(rows.slice((page-1)*pageSize,page*pageSize).map(row=>row.entry)),total,page,pageSize,totalPages,hasMore:page<totalPages};
    }
  };
}
