import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,utimes,stat,symlink,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileFingerprints } from '../server/file-fingerprints.mjs';
test('hash cache deduplicates reads, detects edits with restored mtime and refuses symlinks',async()=>{
  const root=await mkdtemp(join(tmpdir(),'af-fingerprint-'));let reads=0;
  try{const file=join(root,'file');await writeFile(file,'before');const info=await stat(file),hash=createFileFingerprints({onHash:()=>reads++});
    const values=await Promise.all([hash(file),hash(file)]);assert.equal(values[0],values[1]);assert.equal(reads,1);assert.equal(await hash(file),values[0]);assert.equal(reads,1);
    await writeFile(file,'after!');await utimes(file,info.atime,info.mtime);assert.notEqual(await hash(file),values[0]);assert.equal(reads,2);
    await symlink(file,join(root,'link'));await assert.rejects(hash(join(root,'link')),/普通文件/);
  }finally{await rm(root,{recursive:true,force:true});}
});
