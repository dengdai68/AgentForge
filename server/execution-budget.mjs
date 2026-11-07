// Resource admission is separate from Store routing. FIFO per owner and round
// robin across owners prevents a large Run starving a newly opened chat.
export function createExecutionBudget({total=8,perProvider=4}={}) {
  if(!Number.isSafeInteger(total)||total<1||total>64||!Number.isSafeInteger(perProvider)||perProvider<1||perProvider>64)throw new Error('执行并发额度必须在 1 至 64 之间');
  const owners=new Map(),active=new Map();let running=0,closed=false;
  function drain(){
    let moved=true;
    while(running<total&&moved){moved=false;
      for(const [owner,queue] of [...owners]) {
        const index=queue.findIndex(item=>(active.get(item.provider)||0)<perProvider);if(index<0)continue;
        const item=queue.splice(index,1)[0];owners.delete(owner);if(queue.length)owners.set(owner,queue);
        item.signal?.removeEventListener('abort',item.abort);running++;active.set(item.provider,(active.get(item.provider)||0)+1);
        let released=false;item.resolve(()=>{if(released)return;released=true;running--;active.set(item.provider,active.get(item.provider)-1);drain();});moved=true;
        if(running>=total)break;
      }
    }
  }
  return {
    acquire({owner,provider,signal,onWaiting}={}) {
      if(closed||signal?.aborted)return Promise.reject(signal?.reason||new DOMException('执行等待已取消','AbortError'));
      return new Promise((resolve,reject)=>{
        const item={provider,signal,resolve,reject};let queue=owners.get(owner);if(!queue)owners.set(owner,queue=[]);
        item.abort=()=>{const index=queue.indexOf(item);if(index>=0)queue.splice(index,1);if(!queue.length)owners.delete(owner);reject(signal.reason||new Error('执行等待已取消'));drain();};
        signal?.addEventListener('abort',item.abort,{once:true});queue.push(item);
        try { if(running>=total||(active.get(provider)||0)>=perProvider)onWaiting?.(); }
        catch(error) { queue.splice(queue.indexOf(item),1);if(!queue.length)owners.delete(owner);signal?.removeEventListener('abort',item.abort);reject(error); }
        drain();
      });
    },
    status(){return {total,perProvider,running,waiting:[...owners.values()].reduce((n,items)=>n+items.length,0),providers:Object.fromEntries(active)};},
    close(){closed=true;for(const queue of owners.values())for(const item of queue){item.signal?.removeEventListener('abort',item.abort);item.reject(new DOMException('实例已关闭','AbortError'));}owners.clear();}
  };
}
const budgets=new WeakMap();
export function executionBudget(store){
  if(!budgets.has(store))budgets.set(store,createExecutionBudget({total:Number(process.env.AGENTFORGE_MAX_EXECUTIONS||8),perProvider:Number(process.env.AGENTFORGE_MAX_PROVIDER_EXECUTIONS||4)}));
  return budgets.get(store);
}

export function closeExecutionBudget(store){budgets.get(store)?.close();budgets.delete(store);}
