import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {withWorkspaceHooks} from '../server/workspace-hooks.mjs';
const exec=promisify(execFile);
test('native Hook command reaches invocation-bound registration, preserves input, and cleans its socket',async()=>{
 let calls=0,socket;const task={workspacePath:'/fixture'};
 const files={async registerWorkingRepositories(value){assert.equal(value,task);calls++;}};
 const result=await withWorkspaceHooks(files,task,{prompt:'original'},async input=>{
   socket=input.workspaceHook.socket;assert.equal(input.prompt,'original');
   await exec('/bin/sh',['-c',input.workspaceHook.command]);assert.equal(calls,2);
   const status=await new Promise((resolve,reject)=>{const req=http.request({socketPath:socket,path:'/wrong',method:'POST'},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(status,404);
   return 'result';
 });
 assert.equal(result,'result');assert.equal(calls,3);
 await assert.rejects(new Promise((resolve,reject)=>{const req=http.request({socketPath:socket,path:'/register',method:'POST'},resolve);req.on('error',reject);req.end();}));
});
test('registration failures do not change provider outcome',async()=>{
 assert.equal(await withWorkspaceHooks({async registerWorkingRepositories(){throw Error('scan failed');}}, {},{},async()=>42),42);
 await assert.rejects(withWorkspaceHooks({async registerWorkingRepositories(){}},{},{},async()=>{throw Error('provider failed');}),/provider failed/);
});
