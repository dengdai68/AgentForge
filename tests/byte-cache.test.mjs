import test from 'node:test';
import assert from 'node:assert/strict';
import { ByteCache } from '../client/byte-cache.mjs';
test('byte cache bounds keys and values, preserves newer promise replacements and clears rejected work',async()=>{
  const cache=new ByteCache({maxBytes:512,maxEntries:2});cache.set('a','x'.repeat(200)).set('b','y'.repeat(200));cache.get('a');cache.set('c','z'.repeat(200));assert.equal(cache.has('b'),false);assert.ok(cache.bytes<=512);
  cache.set('large','x'.repeat(600));assert.equal(cache.has('large'),false);
  let resolve;const pending=new Promise(r=>{resolve=r;});cache.set('pending',pending);cache.set('pending','new');resolve('old'.repeat(300));await pending;assert.equal(cache.get('pending'),'new');
  const rejected=Promise.reject(new Error('failed'));cache.set('retry',rejected);await rejected.catch(()=>{});assert.equal(cache.has('retry'),false);cache.clear();assert.equal(cache.size,0);assert.equal(cache.bytes,0);
});
