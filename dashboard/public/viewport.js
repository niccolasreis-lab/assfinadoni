// Presentation only: Android owns native system insets; browsers own CSS safe areas.
export function keyboardVisible(baseline, height, editable) {
  return Boolean(editable) && baseline - height > 120;
}
let installed = false;
export function installViewportPolicy() {
  if (installed) return;
  installed = true;
  const root = document.documentElement;
  let width = window.innerWidth;
  let baseline = window.visualViewport?.height || window.innerHeight;
  let queued = false;
  const update = () => {
    queued = false;
    const height = window.visualViewport?.height || window.innerHeight;
    if (window.innerWidth !== width) { width = window.innerWidth; baseline = height; }
    else baseline = Math.max(baseline, height);
    root.dataset.nativeViewport = window.FinanceAndroid ? 'true' : 'false';
    const focused = document.activeElement;
    const editable = focused?.isContentEditable || focused?.matches('textarea,input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=hidden])');
    root.dataset.keyboard = keyboardVisible(baseline, height, editable) ? 'open' : 'closed';
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  update();
  window.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  window.addEventListener('finance-native-resume', schedule);
}
