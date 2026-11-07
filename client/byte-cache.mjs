// LRU for resolved values and in-flight promises. Oversized values may finish
// for their caller, but are never retained. Rejected work is always retryable.
export class ByteCache {
  constructor({maxBytes=8*1024*1024,maxEntries=200}={}) {this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.entries=new Map();this.bytes=0;}
  get size(){return this.entries.size;}
  has(key){return this.entries.has(key);}
  keys(){return this.entries.keys();}
  get(key){const entry=this.entries.get(key);if(!entry)return undefined;this.entries.delete(key);this.entries.set(key,entry);return entry.value;}
  delete(key){const entry=this.entries.get(key);if(!entry)return false;this.bytes-=entry.bytes;return this.entries.delete(key);}
  clear(){this.entries.clear();this.bytes=0;}
  set(key,value){
    this.delete(key);const entry={value,bytes:128};this.entries.set(key,entry);this.bytes+=entry.bytes;
    const settle=result=>{if(this.entries.get(key)!==entry)return;const bytes=new TextEncoder().encode(String(key)).length+new TextEncoder().encode(typeof result==='string'?result:JSON.stringify(result)??'').length;this.bytes+=bytes-entry.bytes;entry.bytes=bytes;this.trim();};
    if(value?.then)value.then(settle,()=>{if(this.entries.get(key)===entry)this.delete(key);});else settle(value);
    this.trim();return this;
  }
  trim(){while(this.bytes>this.maxBytes||this.entries.size>this.maxEntries)this.delete(this.entries.keys().next().value);}
}
