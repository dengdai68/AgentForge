import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
const workflow=yaml.load(await readFile(new URL('../.github/workflows/recover-release-upload.yml',import.meta.url),'utf8'));
const digest=b=>createHash('sha256').update(b).digest('hex');
for(const failure of [null,'public','part','manifest'])test(`draft upload recovery executes real reconstruction: ${failure||'success'}`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'af-release-parts-'));
 try{
  const files=join(root,'files');await mkdir(files);const manifest=[],assets=[];
  for(const ext of ['dmg','zip']){
   const name=`AgentForge-0.1.5-beta.1-arm64.${ext}`,data=Buffer.from(`original ${ext} bytes`),part=`upload-part-${name}-000`;
   await writeFile(join(files,part),failure==='part'?Buffer.from('tampered'):data);
   manifest.push({name,size:data.length,sha256:digest(data),parts:[{name:part,size:data.length,sha256:digest(data)}]});assets.push({id:assets.length+1,name:part,state:'uploaded'});
  }
  const bytes=JSON.stringify(manifest);await writeFile(join(files,'upload-parts.json'),bytes);assets.push({id:3,name:'upload-parts.json',state:'uploaded'});
  await writeFile(join(files,'SHA256SUMS.txt'),manifest.map(f=>`${f.sha256}  ${f.name}`).join('\n'));assets.push({id:4,name:'SHA256SUMS.txt',state:'uploaded'});
  const state=join(root,'state.json');await writeFile(state,JSON.stringify({draft:failure!=='public',target_commitish:'a'.repeat(40),tag_name:'v0.1.5-beta.1',assets}));
  await writeFile(join(root,'gh'),`#!/usr/bin/env python3
import sys,os,json,shutil,hashlib
from pathlib import Path
a=sys.argv[1:];state=Path(os.environ['FIXTURE_STATE']);s=json.loads(state.read_text());files=Path(os.environ['FIXTURE_FILES'])
if a[0]=='api':
 if '-X' in a:
  assert s['draft'];i=int(a[-1].split('/')[-1]);s['assets']=[f for f in s['assets'] if f['id']!=i];state.write_text(json.dumps(s))
 else:print(json.dumps(s))
elif a[:2]==['release','download']:
 name=a[a.index('--pattern')+1];shutil.copyfile(files/name,Path(a[a.index('--dir')+1])/name)
elif a[:2]==['release','upload']:
 assert s['draft'];p=Path(a[3]);b=p.read_bytes();assert not any(f['name']==p.name for f in s['assets']);s['assets'].append({'id':len(s['assets'])+10,'name':p.name,'size':len(b),'digest':'sha256:'+hashlib.sha256(b).hexdigest(),'state':'uploaded'});state.write_text(json.dumps(s))
else:raise RuntimeError('Unexpected command')
`,{mode:0o700});
  const result=spawnSync('python3',['-c',workflow.jobs.recover.steps[0].run],{encoding:'utf8',env:{...process.env,PATH:root+':'+process.env.PATH,GH_REPO:'example/repo',RELEASE_ID:'1',SOURCE_SHA:'a'.repeat(40),MANIFEST_SHA256:failure==='manifest'?'0'.repeat(64):digest(bytes),FIXTURE_STATE:state,FIXTURE_FILES:files},timeout:30000});
  const after=JSON.parse(await readFile(state,'utf8'));
  if(failure){assert.notEqual(result.status,0);assert.equal(after.assets.length,4);}
  else {assert.equal(result.status,0,result.stderr);assert.equal(after.draft,true);assert.deepEqual(after.assets.map(a=>a.name).sort(),['SHA256SUMS.txt',...manifest.map(f=>f.name)].sort());}
 }finally{await rm(root,{recursive:true,force:true});}
});
