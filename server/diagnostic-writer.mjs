import { parentPort,workerData } from 'node:worker_threads';
import { createDiagnosticLog } from './diagnostics.mjs';

const writer=createDiagnosticLog(workerData);
parentPort.on('message',message=>{
  if(message.kind==='flushAsync'){parentPort.postMessage({kind:'flushed',id:message.id,status:writer.status()});return;}
  if(message.kind==='flush'){const signal=new Int32Array(message.signal);Atomics.store(signal,0,1);Atomics.notify(signal,0);return;}
  const record=JSON.parse(message.record),ok=writer.write(record.event,record,value=>value);
  parentPort.postMessage({bytes:message.bytes,ok,status:writer.status()});
});
