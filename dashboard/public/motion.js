// Presentation preferences never change API requests or financial state.
const preferenceKey = 'finance_motion_v2';
const modes = new Set(['off', 'soft', 'full']);
const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
function readMode() {
  try {
    const saved = localStorage.getItem(preferenceKey);
    if (modes.has(saved)) return saved;
    return localStorage.getItem('finance_motion_v1') === 'off' ? 'off' : 'soft';
  } catch { return 'soft'; }
}
let mode = readMode();
const active = new Set();
export const getMotionMode = () => mode;
export const motionEnabled = () => mode !== 'off' && !preference.matches;
function applyPreference() {
  document.documentElement.dataset.motion = motionEnabled() ? 'on' : 'off';
  document.documentElement.dataset.motionMode = mode;
  if (!motionEnabled()) for (const animation of active) animation.finish();
  const select = document.getElementById('motion-mode');
  if (select) select.value = mode;
  const status = document.getElementById('motion-mode-status');
  if (status) status.textContent = preference.matches
    ? 'Movimento reduzido do sistema ativo: as animações estão desativadas. Sua escolha permanece salva.'
    : {off:'Sem animações. Todas as funções continuam disponíveis.',soft:'Transições breves e discretas. Recomendado para uso diário.',full:'Transições e efeitos visuais completos, sem efeitos 3D.'}[mode];
  window.dispatchEvent(new Event('finance:motion'));
}
export function setMotionMode(value) {
  if (!modes.has(value)) return;
  // Complete an in-flight transition before changing its motion policy.
  for (const animation of active) animation.finish();
  mode = value;
  try { localStorage.setItem(preferenceKey, mode); } catch { /* Keep the in-memory preference. */ }
  applyPreference();
}
// Keep existing integrations using the binary API compatible.
export function setMotionEnabled(value) { setMotionMode(value ? 'soft' : 'off'); }
const reduced = () => !motionEnabled();
function initializePreference() {
  applyPreference();
  document.getElementById('motion-mode')?.addEventListener('change', event => setMotionMode(event.target.value));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializePreference, { once: true }); else initializePreference();
preference.addEventListener('change', applyPreference);
window.addEventListener('storage', event => { if (event.key === preferenceKey || event.key === null) { mode = readMode(); applyPreference(); } });
const running = new WeakMap(), installed = new WeakSet(), detailsInstalled = new WeakSet();
let observer;
function animate(element, frames, duration) {
  if (!element) return Promise.resolve();
  running.get(element)?.cancel();
  if (reduced() || !element.animate) return Promise.resolve();
  const soft = mode === 'soft';
  if (soft) frames = frames.at(-1)?.opacity === 0 ? [{opacity:1},{opacity:0}] : [{opacity:.92},{opacity:1}];
  const animation = element.animate(frames, { duration:soft ? Math.min(duration,140) : duration, easing:'cubic-bezier(.16,1,.3,1)' });
  running.set(element, animation);active.add(animation);
  return animation.finished.catch(() => {}).finally(() => { active.delete(animation);if(running.get(element) === animation) running.delete(element); });
}
export function reveal(element) {
  if (!element || element.hidden) return;
  return animate(element, [{opacity:.7,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],220);
}
const detailMotion = new WeakMap();
function installDetails(detail) {
  if(detailsInstalled.has(detail))return;
  const summary=detail.querySelector(':scope > summary');if(!summary)return;
  detailsInstalled.add(detail);
  summary.addEventListener('click',event=>{
    if(event.defaultPrevented || reduced() || mode !== 'full' || !detail.animate || event.target.closest('a,button,input,select,textarea'))return;
    event.preventDefault();
    const previous=detailMotion.get(detail), opening=previous ? !previous.opening : !detail.open;
    const start=detail.getBoundingClientRect().height;
    previous?.animation.cancel();
    const overflow=previous?.overflow ?? detail.style.overflow;
    // Measure the native closed/open heights before the next paint, with no fixed height.
    detail.open=false;const closed=detail.getBoundingClientRect().height;
    detail.open=true;const expanded=detail.getBoundingClientRect().height;
    detail.style.overflow='hidden';
    const animation=detail.animate([{height:`${start}px`},{height:`${opening?expanded:closed}px`}],{duration:200,easing:'cubic-bezier(.16,1,.3,1)'});
    active.add(animation);
    const current={animation,opening,overflow};detailMotion.set(detail,current);
    animation.finished.catch(()=>{}).then(()=>{
      active.delete(animation);if(detailMotion.get(detail)!==current)return;
      detail.open=opening;detail.style.overflow=overflow;detailMotion.delete(detail);
    });
  });
}
export function installDialogMotion() {
  for (const detail of document.querySelectorAll('details'))installDetails(detail);
  for (const dialog of document.querySelectorAll('dialog')) {
    if(installed.has(dialog))continue;
    installed.add(dialog);
    const show = dialog.showModal.bind(dialog), close = dialog.close.bind(dialog);
    let generation=0, closing=false, closingPromise;
    const entrance=()=>animate(dialog,[{opacity:0,transform:'translateY(12px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],200);
    dialog.showModal = () => {
      generation++; closing=false;closingPromise=undefined;dialog.returnValue='';dialog.classList.remove('is-closing');
      running.get(dialog)?.cancel();
      if (!dialog.open) show();
      return entrance();
    };
    dialog.close = value => {
      if (!dialog.open) return Promise.resolve();
      if (closing) return closingPromise;
      const current=++generation, result=value ?? 'cancel';
      if(reduced()){close(result);return Promise.resolve();}
      closing=true;dialog.classList.add('is-closing');
      closingPromise=animate(dialog,[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(7px) scale(.99)'}],140).then(()=>{
        if(current!==generation)return;
        closing=false;closingPromise=undefined;dialog.classList.remove('is-closing');close(result);
      });
      return closingPromise;
    };
    dialog.closeImmediately = () => {
      generation++;closing=false;closingPromise=undefined;running.get(dialog)?.cancel();dialog.classList.remove('is-closing');close('cancel');
    };
    dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close('cancel');});
    dialog.addEventListener('submit',event=>{
      if(event.target.getAttribute('method') !== 'dialog')return;
      event.preventDefault();dialog.close(event.submitter?.value || 'cancel');
    });
    if(dialog.open)entrance();
  }
  // React and contextual action cards can mount after the initial page setup.
  if(!observer && document.body){
    observer=new MutationObserver(records=>{
      if(records.some(record=>[...record.addedNodes].some(node=>node.nodeType===1 && (node.matches?.('dialog,details') || node.querySelector?.('dialog,details')))))installDialogMotion();
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }
}
