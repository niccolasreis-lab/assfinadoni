let pendingInstall;
const installButton = document.getElementById('install-app');
const installHelp = document.getElementById('install-help');
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

if (installButton) {
  installButton.hidden = standalone();
  installButton.addEventListener('click', async () => {
    if (pendingInstall) {
      const prompt = pendingInstall;
      pendingInstall = undefined;
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch {
        if (typeof installHelp?.showModal === 'function') installHelp.showModal();
      }
    } else if (installHelp) {
      if (typeof installHelp.showModal === 'function') installHelp.showModal();
      else installHelp.hidden = false;
    }
  });
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  pendingInstall = event;
  if (installButton && !standalone()) installButton.hidden = false;
});
window.addEventListener('appinstalled', () => {
  pendingInstall = undefined;
  if (installButton) installButton.hidden = true;
});
document.getElementById('close-install-help')?.addEventListener('click', () => installHelp?.close());
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Normal web usage remains fully available when installation is unsupported.
    });
  });
}
