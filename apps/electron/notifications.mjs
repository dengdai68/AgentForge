import {diagnosticRedactor} from '../../server/diagnostics.mjs';
const redact=diagnosticRedactor();
const identifier=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const label=value=>typeof value==='string'?redact(value).replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,160):'';
// Only metadata from the owned service is accepted. No URL, message body,
// prompt, attachment or renderer-provided notification payload is supported.
export function desktopNotice(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || !identifier(input.id))return null;
  const title=label(input.title);if(!title)return null;
  if(['run.awaiting_acceptance','run.completed'].includes(input.type) && identifier(input.runId) && identifier(input.taskId))return {
    id:input.id,type:input.type,targetId:input.runId,route:'/runs/'+input.runId,
    options:{id:input.id,groupId:'task-'+input.taskId,title:input.type==='run.completed'?'任务已完成':'任务待验收',body:title}
  };
  if(input.type==='communication.message' && identifier(input.conversationId) && label(input.senderName))return {
    id:input.id,type:input.type,targetId:input.conversationId,route:'/communication/'+input.conversationId,
    options:{id:input.id,groupId:'chat-'+input.conversationId,title:label(input.senderName)+' 发来新消息',body:title}
  };
  return null;
}
export function createDesktopNotifications({Notification,authorized,openTarget,onDiagnostic=()=>{}}) {
  const seen=new Set(),active=new Map();let stopped=false,generation=0;
  const clear=()=>{generation++;for(const notice of active.values()){try{notice.close();}catch(error){onDiagnostic('close_failed',{error});}}active.clear();};
  return {
    async receive(input,isCurrent=()=>true) {
      const notice=desktopNotice(input);if(!notice||stopped||!isCurrent()||seen.has(notice.id))return false;
      const epoch=generation;
      seen.add(notice.id);if(seen.size>4096)seen.delete(seen.values().next().value);
      try {
        if(!Notification.isSupported() || !await authorized() || stopped || epoch!==generation || !isCurrent())return false;
        const native=new Notification(notice.options);active.set(notice.id,native);
        if(active.size>256){const key=active.keys().next().value;active.get(key).close();active.delete(key);}
        native.on('failed',(_event,error)=>{active.delete(notice.id);onDiagnostic('failed',{type:notice.type,error:String(error || 'Notification delivery failed')});});
        native.on('close',()=>active.delete(notice.id));
        native.on('click',()=>{
          active.delete(notice.id);
          if(stopped||epoch!==generation||!isCurrent())return;
          void Promise.resolve(authorized()).then(ok=>{if(ok&&!stopped&&epoch===generation&&isCurrent())return openTarget(notice.route);}).catch(error=>onDiagnostic('navigation_failed',{error}));
        });
        native.on('show',()=>onDiagnostic('shown',{type:notice.type}));
        native.show();return true;
      }catch(error){active.delete(notice.id);onDiagnostic('failed',{type:notice.type,error});return false;}
    },
    clear,
    stop(){stopped=true;clear();}
  };
}
