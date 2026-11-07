import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';

const fingerprint = stat => [stat.dev,stat.ino,stat.size,stat.mode,stat.mtimeNs,stat.ctimeNs].join(':');
// Cache hashes, never bytes. lstat and descriptor checks happen on every read;
// ctime catches replacement/content edits even when mtime is restored.
export function createFileFingerprints({maxEntries=10000,concurrency=4,onHash=()=>{}}={}) {
  const cache=new Map(),pending=new Map(),waiters=[];let active=0;
  async function acquire(){if(active>=concurrency)await new Promise(resolve=>waiters.push(resolve));else active++;return()=>{const next=waiters.shift();if(next)next();else active--;};}
  return async function hashFile(path) {
    const info=await lstat(path,{bigint:true});if(!info.isFile()||info.isSymbolicLink())throw new Error('哈希只允许真实普通文件');
    const key=fingerprint(info),old=cache.get(path);
    if(old?.key===key){cache.delete(path);cache.set(path,old);return old.hash;}
    const workKey=path+'\0'+key;if(pending.has(workKey))return pending.get(workKey);
    const work=(async()=>{
      const release=await acquire();let file;
      try {
        file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
        if(fingerprint(await file.stat({bigint:true}))!==key)throw new Error('文件在采集期间变化，请重试');
        const hash=createHash('sha256');onHash(path);
        for await(const chunk of file.createReadStream({autoClose:false,highWaterMark:256*1024}))hash.update(chunk);
        if(fingerprint(await file.stat({bigint:true}))!==key||fingerprint(await lstat(path,{bigint:true}))!==key)throw new Error('文件在采集期间变化，请重试');
        const value=hash.digest('hex');cache.delete(path);cache.set(path,{key,hash:value});while(cache.size>maxEntries)cache.delete(cache.keys().next().value);return value;
      } finally {await file?.close();release();}
    })();pending.set(workKey,work);try{return await work;}finally{pending.delete(workKey);}
  };
}
export const fileFingerprint=createFileFingerprints();
