import { installDialogMotion } from './motion.js';
// Account-scoped, memory-only reminder presentation. Financial details never enter push messages.
const CATEGORIES = ['Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Assinaturas','Outros'];
const $ = id => document.getElementById(`rm-${id}`);
const money = value => Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dayLabel = value => value ? value.split('-').reverse().join('/') : 'Sem data';
function today() {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function closeNow(dialog) { if(dialog.open) { if(dialog.closeImmediately)dialog.closeImmediately();else dialog.close(); } }
function button(text,action,variant='secondary') {const node=document.createElement('button');node.type='button';node.className=`button ${variant}`;node.textContent=text;node.addEventListener('click',action);return node;}
export function createRemindersController({request,onChanged=()=>{}}) {
  const host=document.createElement('div');host.id='reminders-root';
  // This template is static. User and server strings are inserted with textContent only.
  host.innerHTML=`
  <dialog id="rm-center" class="reminders-dialog" aria-labelledby="rm-title"><div class="dialog-body">
    <div class="dialog-heading"><div><h2 id="rm-title">Seus lembretes</h2><p class="muted">Contas a pagar e lançamentos para revisar.</p></div><button id="rm-close" type="button" class="icon-button" aria-label="Fechar lembretes">×</button></div>
    <div class="reminders-toolbar"><div class="reminders-tabs" role="group" aria-label="Tipo de lembrete"><button id="rm-tab-bill" class="button ghost" type="button" aria-pressed="true">Contas a pagar</button><button id="rm-tab-review" class="button ghost" type="button" aria-pressed="false">Para revisar</button></div><button id="rm-new" type="button" class="button primary">Novo lembrete</button></div>
    <p id="rm-status" class="message" role="status" hidden></p><button id="rm-retry" class="button ghost" type="button" hidden>Tentar novamente</button>
    <div id="rm-list" class="reminders-list" aria-live="polite"></div>
    <details class="reminders-preferences"><summary>Notificações neste aparelho</summary><p class="muted">Os avisos na tela bloqueada são discretos, sem nomes de contas ou valores. Abra o assistente para consultar os detalhes.</p><p id="rm-push-status" class="muted" role="status"></p><div class="reminders-push-actions"><button id="rm-enable-push" type="button" class="button secondary">Ativar notificações</button><button id="rm-disable-push" type="button" class="button ghost" hidden>Desativar neste aparelho</button></div><p id="rm-telegram" class="muted"></p></details>
  </div></dialog>
  <dialog id="rm-editor" class="reminders-dialog" aria-labelledby="rm-editor-title"><form id="rm-form" class="dialog-body">
    <div class="dialog-heading"><h2 id="rm-editor-title">Novo lembrete</h2><button id="rm-editor-close" class="icon-button" aria-label="Fechar edição" type="button">×</button></div>
    <fieldset id="rm-fields" class="reminders-fields"><div><label for="rm-kind">Tipo</label><select id="rm-kind"><option value="bill">Conta a pagar</option><option value="review">Lançamento para revisar</option></select></div>
    <div><label for="rm-description">Descrição</label><input id="rm-description" type="text" required maxlength="180" placeholder="Ex.: conta de energia"></div>
    <div class="field-grid"><div><label for="rm-amount">Valor (R$)</label><input id="rm-amount" type="number" min="0.01" max="100000000" step="0.01" inputmode="decimal" placeholder="Opcional ao salvar"></div><div><label for="rm-category">Categoria</label><select id="rm-category"><option value="">Escolha ao concluir</option></select></div></div>
    <div id="rm-due-field"><label for="rm-due">Vencimento</label><input id="rm-due" type="date"></div>
    <div><label for="rm-date">Data do lançamento ao concluir</label><input id="rm-date" type="date"><small class="muted">Concluir registra uma despesa nesta data. Salvar apenas mantém o lembrete.</small></div>
    <div id="rm-schedule"><span class="reminders-field-label">Avisar antes do vencimento</span><div class="reminders-offsets"><label><input id="rm-offset-3" type="checkbox" checked>3 dias</label><label><input id="rm-offset-1" type="checkbox" checked>1 dia</label><label><input id="rm-offset-0" type="checkbox" checked>No dia</label></div><label for="rm-hour">Horário em São Paulo</label><input id="rm-hour" type="number" min="0" max="23" step="1" value="9"></div>
    <div class="reminders-channels"><label><input id="rm-notify-telegram" type="checkbox" checked>Avisar no Telegram</label><label><input id="rm-notify-push" type="checkbox" checked>Avisar neste aparelho, se ativado</label></div>
    </fieldset><p id="rm-editor-error" class="message error" role="alert" hidden></p>
    <div class="dialog-actions reminders-editor-actions"><button id="rm-editor-cancel" type="button" class="button ghost">Voltar</button><button id="rm-save" type="submit" class="button secondary" value="save">Salvar lembrete</button><button id="rm-complete" type="submit" class="button primary" value="complete" hidden>Concluir e lançar</button></div>
  </form></dialog>
  <dialog id="rm-cancel-dialog" aria-labelledby="rm-cancel-title" aria-describedby="rm-cancel-copy"><div class="dialog-body"><h2 id="rm-cancel-title">Cancelar lembrete?</h2><p id="rm-cancel-copy"></p><p class="muted">Isso encerra os avisos e não registra uma despesa.</p><p id="rm-cancel-error" class="message error" role="alert" hidden></p><div class="dialog-actions"><button id="rm-cancel-back" type="button" class="button ghost" autofocus>Voltar</button><button id="rm-cancel-confirm" type="button" class="button destructive">Cancelar lembrete</button></div></div></dialog>`;
  document.body.append(host);
  installDialogMotion();
  const bell=button('',()=>open(),'ghost');bell.id='reminders-trigger';bell.className='icon-button reminders-trigger';bell.setAttribute('aria-label','Abrir lembretes');bell.setAttribute('aria-haspopup','dialog');bell.setAttribute('aria-controls','rm-center');
  bell.innerHTML='<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="reminders-count" hidden aria-hidden="true"></span>';
  document.querySelector('.top-actions')?.prepend(bell);
  const settingsButton=button('Lembretes e notificações',()=>open());document.querySelector('#settings-panel .help-row')?.append(settingsButton);
  for(const category of CATEGORIES){const option=document.createElement('option');option.value=category;option.textContent=category;$('category').append(option);}
  let account=null,epoch=0,listTicket=0,reminders=[],tab='bill',editing=null,cancelling=null,busy=false,pushBusy=false,pushGeneration=0,interval=null,lastLoad=0,pushKey=null;
  let pendingOpen=new URLSearchParams(location.search).get('reminders')==='1';
  function message(id,text='',error=false){const node=$(id);node.textContent=text;node.hidden=!text;node.classList.toggle('error',error);}
  function controls(){ $('fields').disabled=busy;$('save').disabled=busy;$('complete').disabled=busy;$('new').disabled=busy;$('cancel-confirm').disabled=busy;host.querySelectorAll('[data-reminder-action]').forEach(b=>b.disabled=busy); }
  function updateBadge(){const count=reminders.filter(row=>row.status==='pending').length;const badge=bell.querySelector('.reminders-count');badge.textContent=count>99?'99+':String(count);badge.hidden=!count;bell.setAttribute('aria-label',count?`Abrir lembretes: ${count} pendentes`:'Abrir lembretes');}
  function render(){
    $('tab-bill').setAttribute('aria-pressed',String(tab==='bill'));$('tab-review').setAttribute('aria-pressed',String(tab==='review'));
    const list=$('list');list.replaceChildren();const pending=reminders.filter(row=>row.status==='pending'&&row.kind===tab);
    if(!pending.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=tab==='bill'?'Nenhuma conta pendente. Adicione um lembrete para se organizar.':'Nenhum lançamento aguardando revisão.';list.append(empty);}
    for(const row of pending){const article=document.createElement('article');article.className='reminder-item';const heading=document.createElement('h3');heading.textContent=row.description;const detail=document.createElement('p');detail.className='muted';detail.textContent=[row.kind==='bill'?`Vence em ${dayLabel(row.due_date)}`:`Data: ${dayLabel(row.transaction_date)}`,row.amount!==null&&row.amount!==undefined?money(row.amount):'Valor a revisar',row.category||'Categoria a revisar'].join(' · ');const origin=document.createElement('small');origin.className='muted';origin.textContent=[row.short_code?`Código ${row.short_code}`:null,row.source==='telegram'?'Criado pelo Telegram':'Criado na web'].filter(Boolean).join(' · ');const actions=document.createElement('div');actions.className='reminder-item-actions';const edit=button('Revisar e concluir',()=>editReminder(row),'secondary');const cancel=button('Cancelar lembrete',()=>confirmCancel(row),'ghost');for(const b of [edit,cancel])b.dataset.reminderAction='true';actions.append(edit,cancel);article.append(heading,detail,origin,actions);list.append(article);}
    controls();updateBadge();
  }
  async function load({quiet=false}={}){
    if(!account||busy)return;const context=epoch,ticket=++listTicket;lastLoad=Date.now();$('retry').hidden=true;
    if(!quiet)message('status','Carregando lembretes...');
    try{const result=await request('/api/reminders');if(context!==epoch||ticket!==listTicket)return;reminders=Array.isArray(result.reminders)?result.reminders:[];$('telegram').textContent=result.telegram_linked?'Telegram conectado: os avisos seguem as preferências de cada lembrete.':'Telegram não conectado. Você pode gerenciar lembretes e ativar avisos neste aparelho.';render();message('status');}
    catch(error){if(context!==epoch||ticket!==listTicket)return;message('status',error.message||'Não foi possível carregar os lembretes. Verifique sua conexão.',true);$('retry').hidden=false;}
  }
  function fieldsForKind(){const bill=$('kind').value==='bill';$('due-field').hidden=!bill;$('due').required=bill;$('schedule').hidden=!bill;}
  function editReminder(row=null){
    if(!account||busy)return;editing=row;closeNow($('center'));$('form').reset();$('kind').value=row?.kind||tab;$('kind').disabled=Boolean(row);$('description').value=row?.description||'';$('amount').value=row?.amount??'';$('category').value=row?.category||'';$('due').value=row?.due_date||today();$('date').value=row?.transaction_date||today();$('date').max=today();$('hour').value=row?.reminder_hour??9;
    for(const offset of [3,1,0])$(`offset-${offset}`).checked=(row?.reminder_offsets||[3,1,0]).includes(offset);
    $('notify-telegram').checked=row?.notify_telegram!==false;$('notify-push').checked=row?.notify_push!==false;$('complete').hidden=!row;$('editor-title').textContent=row?'Revisar lembrete':'Novo lembrete';message('editor-error');fieldsForKind();controls();$('editor').showModal();$('description').focus();
  }
  function confirmCancel(row){if(busy)return;cancelling=row;closeNow($('center'));$('cancel-copy').textContent=row.description;message('cancel-error');$('cancel-dialog').showModal();$('cancel-back').focus();}
  function back(dialog){closeNow(dialog);if(account){$('center').showModal();$('new').focus();}}
  async function mutate(pathBody,{complete=false,cancel=false}={}){
    if(!account||busy)return;const context=epoch;busy=true;listTicket++;controls();const errorId=cancel?'cancel-error':'editor-error';message(errorId);
    try{await request('/api/reminders',{method:pathBody.id?'PATCH':'POST',body:JSON.stringify(pathBody)});if(context!==epoch)return;tab=pathBody.kind||(cancel?cancelling?.kind:editing?.kind)||tab;closeNow($('editor'));closeNow($('cancel-dialog'));busy=false;controls();await load();if(context!==epoch)return;$('center').showModal();message('status',complete?'Despesa registrada e lembrete concluído.':cancel?'Lembrete cancelado.':'Lembrete salvo.');if(complete)await onChanged();}
    catch(error){if(context===epoch)message(errorId,error.message||'Não foi possível salvar. Tente novamente.',true);}
    finally{if(context===epoch){busy=false;controls();}}
  }
  function pushAvailable(){return 'Notification'in window&&'serviceWorker'in navigator&&'PushManager'in window&&window.isSecureContext;}
  async function registration(){let timer;try{return await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('O app ainda está preparando as notificações. Tente novamente.')),8000);})]);}finally{clearTimeout(timer);}}
  async function refreshPush(){
    const context=epoch;if(!account)return;
    if(!pushAvailable()){$('push-status').textContent='Este navegador não oferece notificações neste contexto. No iPhone, instale o app e abra pela tela inicial.';$('enable-push').disabled=true;return;}
    try{const result=await request('/api/push');if(context!==epoch)return;pushKey=result.publicKey;const reg=await navigator.serviceWorker.getRegistration('/');const subscription=await reg?.pushManager.getSubscription();if(context!==epoch)return;$('disable-push').hidden=!subscription;$('enable-push').hidden=Boolean(subscription);$('enable-push').disabled=!pushKey;$('push-status').textContent=subscription?'Notificações ativadas neste aparelho.':!pushKey?'As notificações do navegador ainda não foram configuradas. Os lembretes continuam disponíveis aqui.':Notification.permission==='denied'?'Notificações bloqueadas no navegador. Altere a permissão do site e tente novamente.':'Ative apenas se quiser receber avisos neste aparelho.';}
    catch{if(context===epoch){$('enable-push').disabled=false;$('push-status').textContent='Não foi possível consultar as notificações. Tente ativar novamente quando estiver conectado.';}}
  }
  function vapidBytes(value){const text=atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));return Uint8Array.from(text,c=>c.charCodeAt(0));}
  async function enablePush(){
    if(!account||pushBusy||!pushAvailable())return;const context=epoch,pushTicket=++pushGeneration;const current=()=>context===epoch&&pushTicket===pushGeneration;pushBusy=true;$('enable-push').disabled=true;
    try{
      // Request permission directly inside this user gesture, before network waits.
      const permission=await Notification.requestPermission();if(!current())return;if(permission!=='granted'){$('push-status').textContent=permission==='denied'?'Notificações bloqueadas. Você pode permitir o site nas configurações do navegador.':'Notificações não ativadas. Você pode tentar novamente quando quiser.';return;}
      if(!pushKey){const config=await request('/api/push');if(!current())return;pushKey=config.publicKey;}
      if(!pushKey)throw new Error('As notificações do navegador ainda não foram configuradas.');
      const reg=await registration();if(!current())return;const subscription=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(pushKey)});if(!current()){await subscription.unsubscribe();return;}
      try{await request('/api/push',{method:'POST',body:JSON.stringify({subscription:subscription.toJSON()})});}catch(error){await subscription.unsubscribe();throw error;}
      if(!current()){await subscription.unsubscribe();return;}await refreshPush();
    }catch(error){if(current())$('push-status').textContent=error.message||'Não foi possível ativar. Tente novamente.';}
    finally{if(current()){pushBusy=false;$('enable-push').disabled=false;}}
  }
  async function detachPush(){if(!pushAvailable())return;const reg=await navigator.serviceWorker.getRegistration('/');const subscription=await reg?.pushManager.getSubscription();if(subscription){try{await request('/api/push',{method:'DELETE',body:JSON.stringify({endpoint:subscription.endpoint})});}finally{await subscription.unsubscribe();}}}
  async function disablePush(){if(!account||pushBusy)return;const context=epoch;pushBusy=true;$('disable-push').disabled=true;try{await detachPush();if(context===epoch)await refreshPush();}catch(error){if(context===epoch)$('push-status').textContent=error.message||'Não foi possível desativar. Tente novamente.';}finally{if(context===epoch){pushBusy=false;$('disable-push').disabled=false;}}}
  function open(){if(!account)return;closeNow($('editor'));closeNow($('cancel-dialog'));$('center').showModal();load();refreshPush();}
  $('close').addEventListener('click',()=>$('center').close());$('new').addEventListener('click',()=>editReminder());$('retry').addEventListener('click',()=>load());
  for(const kind of ['bill','review'])$(`tab-${kind}`).addEventListener('click',()=>{tab=kind;render();});
  $('kind').addEventListener('change',fieldsForKind);
  for(const id of ['editor-close','editor-cancel'])$(id).addEventListener('click',()=>back($('editor')));
  $('cancel-back').addEventListener('click',()=>back($('cancel-dialog')));
  $('cancel-confirm').addEventListener('click',()=>{if(cancelling)mutate({id:cancelling.id,action:'cancel'},{cancel:true});});
  $('form').addEventListener('submit',event=>{
    event.preventDefault();if(busy||!account)return;const complete=event.submitter?.value==='complete';const kind=$('kind').value;const amount=$('amount').value?Number($('amount').value):null,category=$('category').value||null,date=$('date').value||null;
    if(complete&&(!editing||!amount||!category||!date||date>today())){message('editor-error','Para registrar a despesa, informe valor, categoria e uma data até hoje.',true);return;}
    const body={...(editing?{id:editing.id,action:complete?'complete':'update'}:{kind}),description:$('description').value.trim(),amount,category,...(kind==='bill'?{due_date:$('due').value}:{transaction_date:date}),reminder_offsets:[3,1,0].filter(n=>$(`offset-${n}`).checked),reminder_hour:Number($('hour').value),notify_telegram:$('notify-telegram').checked,notify_push:$('notify-push').checked};
    if(complete)body.transaction_date=date;
    mutate(body,{complete});
  });
  $('enable-push').addEventListener('click',enablePush);$('disable-push').addEventListener('click',disablePush);
  navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='OPEN_REMINDERS'){if(account)open();else pendingOpen=true;}else if(event.data?.type==='PUSH_SUBSCRIPTION_CHANGED'&&account)refreshPush();});
  const onFocus=()=>{if(account&&!document.hidden&&!busy&&Date.now()-lastLoad>30000)load({quiet:true});};window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onFocus);
  return {
    sync(next){if(!next)return;const changed=!account||account.id!==next.id||account.username!==next.username;if(changed){this.reset();account=next;load();interval=setInterval(()=>{if($('center').open&&!document.hidden&&!busy)load({quiet:true});},60000);if(pendingOpen){pendingOpen=false;open();}}else account=next;},
    open,
    async beforeLogout(){pushGeneration++;pushBusy=false;try{await detachPush();}catch{/* Logout must still proceed; browser unsubscribe is attempted even when offline. */}},
    reset(){epoch++;pushGeneration++;listTicket++;account=null;reminders=[];editing=null;cancelling=null;busy=false;pushBusy=false;pushKey=null;clearInterval(interval);interval=null;for(const id of ['center','editor','cancel-dialog'])closeNow($(id));$('form').reset();$('list').replaceChildren();for(const id of ['status','editor-error','cancel-error'])message(id);$('push-status').textContent='';$('enable-push').hidden=false;$('enable-push').disabled=false;$('disable-push').hidden=true;$('disable-push').disabled=false;updateBadge();controls();},
  };
}
