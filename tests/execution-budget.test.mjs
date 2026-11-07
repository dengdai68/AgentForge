import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionBudget } from '../server/execution-budget.mjs';
test('shared budget bounds providers, queues fairly and releases cancellation',async()=>{
  const pool=createExecutionBudget({total:2,perProvider:1}),first=await pool.acquire({owner:'run',provider:'a'}),other=await pool.acquire({owner:'chat',provider:'b'}),order=[];
  const queued=pool.acquire({owner:'run',provider:'a'}).then(release=>{order.push('run');return release;});
  const controller=new AbortController(),cancelled=pool.acquire({owner:'cancel',provider:'b',signal:controller.signal});controller.abort(new Error('cancelled'));await assert.rejects(cancelled,/cancelled/);
  const chat=pool.acquire({owner:'chat',provider:'a'}).then(release=>{order.push('chat');return release;});
  assert.equal(pool.status().running,2);other();assert.equal(pool.status().waiting,2);first();const release=await queued;assert.deepEqual(order,['run']);release();(await chat)();assert.equal(pool.status().running,0);
  const held=await pool.acquire({owner:'run',provider:'a'});await assert.rejects(pool.acquire({owner:'run',provider:'a',onWaiting(){throw new Error('observer');}}),/observer/);assert.equal(pool.status().waiting,0);held();pool.close();await assert.rejects(pool.acquire({owner:'run',provider:'a'}));
});

test('shutdown rejects waiting and future work as cancellation without leaking admission slots',async()=>{
  const pool=createExecutionBudget({total:1,perProvider:1}),release=await pool.acquire({owner:'active',provider:'a'});
  const waiting=pool.acquire({owner:'queued',provider:'a'});
  pool.close();
  await assert.rejects(waiting,{name:'AbortError'});
  await assert.rejects(pool.acquire({owner:'new',provider:'a'}),{name:'AbortError'});
  assert.equal(pool.status().waiting,0);release();assert.equal(pool.status().running,0);
});
