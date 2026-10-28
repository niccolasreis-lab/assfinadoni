(() => {
  const dialog = [...document.querySelectorAll('dialog[open]')].pop();
  if (dialog) { dialog.close('cancel'); return true; }
  const popover = document.querySelector('[popover]:popover-open');
  if (popover) { popover.hidePopover(); return true; }
  return false;
})()
