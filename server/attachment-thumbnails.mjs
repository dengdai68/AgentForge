import sharp from 'sharp';
import { pipeline } from 'node:stream/promises';
import { createExecutionBudget } from './execution-budget.mjs';

sharp.cache({memory:16,files:0,items:64});sharp.concurrency(1);
const budget=createExecutionBudget({total:2,perProvider:2}),cache=new Map(),pending=new Map();let bytes=0;
export async function attachmentThumbnail(key,open) {
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
  if(pending.has(key))return pending.get(key);
  if(budget.status().waiting>=32)throw new Error('图片预览繁忙，请稍后重试');
  const work=(async()=>{const release=await budget.acquire({owner:key,provider:'image'});let source;
    try{
      source=await open();const image=sharp({limitInputPixels:16*1024*1024,pages:1,failOn:'error'}).rotate().resize(144,144,{fit:'inside',withoutEnlargement:true}).png();
      const output=image.toBuffer();const [,value]=await Promise.all([pipeline(source.stream,image),output]);
      cache.set(key,value);bytes+=value.length;while(bytes>16*1024*1024||cache.size>1000){const oldest=cache.keys().next().value;bytes-=cache.get(oldest).length;cache.delete(oldest);}return value;
    }finally{source?.stream.destroy();release();}
  })();pending.set(key,work);try{return await work;}finally{pending.delete(key);}
}
