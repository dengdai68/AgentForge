import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { createRunFiles } from '../server/run-files.mjs';
import { attachmentThumbnail } from '../server/attachment-thumbnails.mjs';
test('streamed attachments preserve verified bytes and thumbnails are bounded, shared derivatives',async()=>{
  const root=await mkdtemp(join(tmpdir(),'af-attachment-stream-'));
  try{
    const files=createRunFiles({root}),image=await sharp({create:{width:1200,height:900,channels:3,background:'#345678'}}).png().toBuffer();
    const record=await files.writeRunAttachment('run_image','image.png',Readable.from([image.subarray(0,9),image.subarray(9)]));
    const open=()=>files.openAttachment('runs','run_image',record);let reads=0;
    const [a,b]=await Promise.all([attachmentThumbnail(record.sha256,()=>{reads++;return open();}),attachmentThumbnail(record.sha256,()=>{reads++;return open();})]);
    assert.equal(reads,1);assert.deepEqual(a,b);const size=await sharp(a).metadata();assert.equal(size.width,144);assert.equal(size.height,108);
    const download=await open(),chunks=[];for await(const chunk of download.stream)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),image);
    await writeFile(files.runAttachmentPath('run_image',record),'bad');await assert.rejects(files.validateAttachment('runs','run_image',record),/完整性/);await assert.rejects(open(),/完整性/);
    await assert.rejects(files.writeRunAttachment('run_image','large.bin',Readable.from([Buffer.alloc(20*1024*1024),Buffer.alloc(1)])),/20 MiB/);
  }finally{await rm(root,{recursive:true,force:true});}
});
