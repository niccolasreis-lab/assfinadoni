(() => {
  'use strict';
  if (location.origin !== 'https://assfinadoni.vercel.app' || window.top !== window || window.__financeNativeReady || !window.FinanceAndroid) return;
  window.__financeNativeReady = true;
  let ticket = 0, timer, readySent = false;
  const pending = new Map();
  function command(action, payload = {}) {
    const id = String(++ticket);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('O Android não respondeu. Tente novamente.')); }, action === 'update' ? 240000 : 35000);
      pending.set(id, { resolve, reject, timeout });
      FinanceAndroid.postMessage(JSON.stringify({ id, action, ...payload }));
    });
  }
  FinanceAndroid.onmessage = event => {
    try {
      const data = JSON.parse(event.data), item = pending.get(data.id);
      if (!item) return;
      clearTimeout(item.timeout); pending.delete(data.id);
      if (data.error) item.reject(new Error(data.error)); else item.resolve(data);
    } catch { /* Ignore malformed native messages. */ }
  };
  const sync = () => { clearTimeout(timer); timer = setTimeout(() => command('sync').catch(() => {}), 500); };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const url = new URL(typeof args[0] === 'string' || args[0] instanceof URL ? args[0] : args[0].url, location.href);
      if (url.origin === location.origin && response.ok && ['/api/session', '/api/reminders'].includes(url.pathname)) {
        const method = (args[1]?.method || args[0]?.method || 'GET').toUpperCase();
        if(url.pathname === '/api/session' && method === 'DELETE') { clearTimeout(timer); command('logout').catch(() => {}); } else sync();
      }
    } catch { /* Financial requests and their responses remain untouched. */ }
    return response;
  };
  if (!navigator.share) Object.defineProperty(navigator, 'share', { configurable: true, value: data => {
    if (data.files?.length) return Promise.reject(new Error('Compartilhamento de arquivos não disponível nesta tela.'));
    return command('share', { title: String(data.title || '').slice(0, 180), text: String(data.text || '').slice(0, 8000) });
  } });
  let updateCard, checkingUpdate=false, lastUpdateCheck=0;
  async function checkUpdates(manual=false) {
    if(checkingUpdate || (!manual && Date.now()-lastUpdateCheck<3600000))return;
    checkingUpdate=true;lastUpdateCheck=Date.now();
    const status=document.getElementById('native-update-status');
    try {
      const release=await command('updates');
      if(status)status.textContent=release.available ? 'Nova versão disponível.' : 'Nenhuma atualização publicada para este aparelho.';
      if(!release.available){updateCard?.remove();updateCard=null;return;}
      if(updateCard)return;
      updateCard=document.createElement('section');updateCard.className='panel';updateCard.id='native-update-card';updateCard.setAttribute('aria-label','Atualização do aplicativo');
      const title=document.createElement('h2');title.textContent='Atualização disponível: '+release.version;
      const notes=document.createElement('p');notes.textContent=release.notes || 'Melhorias e correções do aplicativo.';
      const message=document.createElement('p');message.setAttribute('role','status');
      const button=document.createElement('button');button.type='button';button.className='button primary';button.textContent='Baixar e atualizar';
      button.addEventListener('click',async()=>{
        button.disabled=true;message.textContent='Baixando e verificando a atualização…';
        try { const result=await command('update');message.textContent=result.message; }
        catch(error){message.textContent=error.message;}finally{button.disabled=false;}
      });
      updateCard.append(title,notes,button,message);
      (document.querySelector('#dashboard-view .content') || document.body).prepend(updateCard);
    }catch(error){if(manual && status)status.textContent=error.message;}finally{checkingUpdate=false;}
  }
  window.addEventListener('finance-native-resume',()=>checkUpdates());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkUpdates();});
  function mount() {
    if (!document.head || !document.body) return;
    const loading=document.getElementById('initial-status');
    if(!readySent && (!loading || loading.hidden) && ['login-view','dashboard-view'].some(id=>{const el=document.getElementById(id);return el && !el.hidden && getComputedStyle(el).display!=='none'})) {readySent=true;command('ready').catch(()=>{});}
    for (const id of ['install-app','rm-enable-push','rm-disable-push','rm-push-status']) { const el=document.getElementById(id); if(el && !el.hidden)el.hidden=true; }
    const settings=document.getElementById('settings-panel');
    if(settings && !document.getElementById('native-check-updates')) {
      const button=document.createElement('button');button.id='native-check-updates';button.type='button';button.className='button secondary';button.textContent='Verificar atualização do APK';
      const status=document.createElement('p');status.id='native-update-status';status.setAttribute('role','status');
      button.addEventListener('click',()=>checkUpdates(true));settings.append(button,status);checkUpdates();
    }
    const prefs = document.querySelector('#rm-center .reminders-preferences');
    if (prefs && !document.getElementById('native-notifications')) {
      const box = document.createElement('div'); box.id = 'native-notifications';
      const status = document.createElement('p'); status.className = 'muted'; status.setAttribute('role','status');
      status.textContent = 'Android: avisos locais e sincronização periódica. O push imediato ainda depende da configuração do Firebase.';
      const actions = document.createElement('div'); actions.className = 'help-row';
      for (const [action, label] of [['enable','Permitir notificações'],['settings','Configurar avisos'],['exact','Horário exato'],['test','Testar aviso'],['sync','Sincronizar agora']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = label;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try { const r = await command(action); status.textContent = r.message || 'Configuração aberta no Android.'; }
          catch (error) { status.textContent = error.message; }
          finally { button.disabled = false; }
        }); actions.append(button);
      }
      box.append(status, actions); prefs.append(box);
    }
  }
  const observer = new MutationObserver(mount);
  const start = () => { mount(); observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden'] }); sync(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true }); else start();
  window.addEventListener('finance-native-resume',()=>checkUpdates());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('finance-native-resume', sync);
  window.addEventListener('finance-native-open-reminders', () => {
    const button = document.getElementById('reminders-trigger');
    if (button) button.click();
    else window.dispatchEvent(new MessageEvent('message', { data: {type:'OPEN_REMINDERS'} }));
  });
})();
