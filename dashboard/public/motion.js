// Motion is interruptible and never delays requests or session cleanup.
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const running = new WeakMap();
const installed = new WeakSet();
function animate(element, frames, duration) {
  running.get(element)?.cancel();
  if (!element || reduced() || !element.animate) return Promise.resolve();
  const animation = element.animate(frames, { duration, easing:'cubic-bezier(.16,1,.3,1)' });
  running.set(element, animation);
  return animation.finished.catch(() => {}).finally(() => { if(running.get(element) === animation) running.delete(element); });
}
export function reveal(element) {
  if (!element || element.hidden) return;
  return animate(element, [{opacity:.7,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],220);
}
export function installDialogMotion() {
  for (const dialog of document.querySelectorAll('dialog')) {
    if(installed.has(dialog))continue;
    installed.add(dialog);
    const show = dialog.showModal.bind(dialog), close = dialog.close.bind(dialog);
    let generation=0, closing=false;
    dialog.showModal = () => {
      generation++; closing=false; dialog.classList.remove('is-closing');
      running.get(dialog)?.cancel();
      if (!dialog.open) show();
      animate(dialog,[{transform:'translateY(14px) scale(.98)'},{transform:'translateY(0) scale(1)'}],220);
    };
    dialog.close = value => {
      if (!dialog.open || closing) return;
      const current=++generation;
      if(reduced()){close(value);return;}
      closing=true; dialog.classList.add('is-closing');
      return animate(dialog,[{transform:'translateY(0) scale(1)'},{transform:'translateY(9px) scale(.99)'}],150).then(()=>{
        if(current!==generation)return;
        closing=false; dialog.classList.remove('is-closing');close(value);
      });
    };
    dialog.closeImmediately = () => {
      generation++; closing=false; running.get(dialog)?.cancel(); dialog.classList.remove('is-closing');close('cancel');
    };
    dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close('cancel');});
    dialog.addEventListener('submit',event=>{
      if(event.target.getAttribute('method') !== 'dialog')return;
      event.preventDefault(); dialog.close(event.submitter?.value || '');
    });
  }
}
