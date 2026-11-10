// Dialogs/popovers live above all CSS stacking contexts. Feedback uses the same
// top layer, with no interactive/focusable content and no modal ownership.
export function createToast(box, {duration=3600}={}) {
  const document=box.ownerDocument,window=document.defaultView;
  box.setAttribute('popover','manual');
  let timer=null;
  function raise() {
    if(!box.classList.contains('show'))return;
    if(box.matches(':popover-open'))box.hidePopover();
    box.showPopover();
  }
  document.addEventListener('toggle',event=>{
    if(event.target!==box && event.newState==='open')raise();
  },true);
  return (message,isError=false)=>{
    box.textContent=String(message);
    box.className=`toast show${isError?' error':''}`;
    box.setAttribute('role',isError?'alert':'status');
    raise();window.clearTimeout(timer);
    timer=window.setTimeout(()=>{box.className='toast';if(box.matches(':popover-open'))box.hidePopover();},duration);
  };
}
