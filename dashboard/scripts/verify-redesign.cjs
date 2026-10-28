// Browser-only fixtures. Never shipped in public/ or used by production APIs.
// Run: PLAYWRIGHT_MODULE=/path/to/playwright node scripts/verify-redesign.cjs
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const out=process.env.QA_OUTPUT || '/tmp/finance-redesign-qa';fs.mkdirSync(out,{recursive:true});
const nativeMode=process.env.QA_ANDROID === '1';
const base=nativeMode ? 'https://assfinadoni.vercel.app' : process.env.QA_URL || 'http://127.0.0.1:4173';
(async()=>{
const browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
const errors=[]; const result=[];
for(const width of [360,768,1024,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},locale:'pt-BR',serviceWorkers:'block'});const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error' && !(fail && m.text().includes('500 (Internal Server Error)')))errors.push(m.text());});
 if(nativeMode){
  const path=require('node:path'), dist=path.resolve(process.env.QA_DIST||'dist');
  await page.route(base+'/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname.startsWith('/api/'))return route.fallback();
   const target=path.resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));
   if(!target.startsWith(dist+path.sep)||!fs.existsSync(target))return route.fulfill({status:404,body:''});
   const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.webmanifest':'application/manifest+json'}[path.extname(target)]||'application/octet-stream';
   return route.fulfill({path:target,contentType:mime,headers:{'content-security-policy':"default-src 'self';script-src 'self';style-src 'self';img-src 'self' data:;media-src 'self' blob:;connect-src 'self';worker-src 'self';object-src 'none'"}});
  });
  await page.addInitScript({content:`window.__nativeCommands=[];window.FinanceAndroid={postMessage(raw){const data=JSON.parse(raw);window.__nativeCommands.push(data.action);setTimeout(()=>window.FinanceAndroid.onmessage?.({data:JSON.stringify({id:data.id,message:'Configuração de teste',...(data.action==='updates'?{available:true,version:'9.0.0',notes:'Correção de teste'}:{})})}),0)}};`+fs.readFileSync('../android-native/app/src/main/assets/dashboard-native.js','utf8')});
 }
 let authenticated=false,empty=false,fail=false;
 const account={username:'qa_demo',name:'Conta de teste',telegram_linked:true};
 await page.addInitScript(()=>localStorage.setItem('finance_tutorial_v1_qa_demo','seen'));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/session'){
   if(req.method()==='POST')authenticated=true;
   if(req.method()==='DELETE')authenticated=false;
   return route.fulfill({json:{authenticated,account:authenticated?account:undefined}});
  }
  if(url.pathname==='/api/profile')return route.fulfill({json:{profile:{display_name:account.name,avatar_data_url:null},account}});
  if(url.pathname==='/api/reminders')return route.fulfill({json:{reminders:[],telegram_linked:true}});
  if(url.pathname==='/api/push')return route.fulfill({json:{publicKey:null,supported:true}});
  if(req.method()!=='GET')return route.fulfill({json:{transaction:{id:'qa-1'}}});
  if(fail)return route.fulfill({status:500,json:{error:'Falha simulada para teste'}});
  const month=url.searchParams.get('month')||'2026-09';const n=Number(month.slice(5));
  const transactions=empty?[]:Array.from({length:8},(_,i)=>({id:`qa-${i}`,description:['Mercado da semana','Salário','Almoço','Internet','Transporte','Livros','Café','Cinema'][i],category:['Alimentação','Outros','Alimentação','Moradia','Transporte','Educação','Alimentação','Lazer'][i],amount:i===1?7200:[248.9,0,42,120,65,89,16,50][i],transaction_type:i===1?'receita':'despesa',transaction_date:`${month}-10`,is_owner:true}));
  const filtered=transactions.filter(x=>!url.searchParams.get('type')||url.searchParams.get('type')===x.transaction_type);
  return route.fulfill({json:{account,transactions:filtered,summary:empty?{income:0,expense:0,balance:0,byCategory:{}}:{income:6500+n*80,expense:2300+n*35,balance:4200+n*45,byCategory:{Alimentação:1100+n*35,Moradia:800,Transporte:250,Lazer:150}},pagination:{page:1,hasMore:false}}});
 });
 await page.goto(base);await page.locator('#login-view').waitFor({state:'visible'});
 await page.screenshot({animations:'disabled',path:`${out}/login-${width}.png`,fullPage:true});
 await page.locator('#password').fill('fixture-only');await page.locator('#toggle-password').click();assert.equal(await page.locator('#password').getAttribute('type'),'text');await page.locator('#toggle-password').click();
 await page.locator('#username').fill('qa_demo');await page.locator('#login-submit').click();await page.locator('.history-svg').waitFor();
 assert.equal(await page.locator('#dashboard-view').isVisible(),true);
 await page.evaluate(async()=>{
   const d=document.createElement('dialog');d.id='qa-motion-card';const field=document.createElement('input');field.value='rascunho preservado';d.append(field);document.body.append(d);
   await new Promise(resolve=>requestAnimationFrame(resolve));
   if(typeof d.closeImmediately!=='function')throw Error('Cartão dinâmico sem animação instalada');
   d.showModal();const first=d.close('confirm');const repeated=d.close('confirm');
   if(first!==repeated)throw Error('Fechamento repetido criou duas operações');
   d.showModal();await first;if(!d.open)throw Error('Callback antigo fechou o cartão reaberto');
   const late=d.close('confirm');d.closeImmediately();await late;
   if(d.open || d.returnValue!=='cancel' || d.classList.contains('is-closing'))throw Error('Fechamento imediato não cancelou com segurança');if(field.value!=='rascunho preservado')throw Error('Animação apagou o formulário');d.remove();
 });
 const detail=page.locator('#history-panel details');const summaryControl=detail.locator('summary');
 await summaryControl.click();await summaryControl.click();await summaryControl.click();
 await page.waitForFunction(()=>{const d=document.querySelector('#history-panel details');return d.open && d.getAnimations().length===0});
 assert.equal(await detail.evaluate(el=>el.style.overflow),'');
 await summaryControl.click();await page.waitForFunction(()=>!document.querySelector('#history-panel details').open);

 await page.evaluate(async()=>{
   const motion=await import('/motion.js');motion.setMotionEnabled(false);
   const d=document.getElementById('transaction-dialog');await d.showModal();await d.close('cancel');
   if(d.open || document.documentElement.dataset.motion!=='off')throw Error('Movimento desativado não respeitado');
   motion.setMotionEnabled(true);
 });
 await page.screenshot({animations:'disabled',path:`${out}/dashboard-${width}.png`,fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);
 assert.equal(await page.locator('#expense-total').evaluate(el=>el.scrollWidth>el.clientWidth),false,`expense total clipped ${width}`);
 assert.equal(await page.locator('#income-total').evaluate(el=>el.scrollWidth>el.clientWidth),false,`income total clipped ${width}`);
 await page.locator('#reminders-trigger').click();await page.locator('#rm-list .empty').waitFor();await page.screenshot({animations:'disabled',path:`${out}/reminders-${width}.png`});if(nativeMode){await page.locator('.reminders-preferences summary').click();await page.getByRole('button',{name:'Testar aviso',exact:true}).click();assert((await page.evaluate(()=>window.__nativeCommands)).includes('test'));await page.evaluate(()=>navigator.share({title:'Fixture',text:'Somente teste local'}));assert((await page.evaluate(()=>window.__nativeCommands)).includes('share'));assert.equal(await page.locator('#rm-enable-push').isVisible(),false);}await page.keyboard.press('Escape');await page.locator('#rm-center').waitFor({state:'hidden'});
 await page.locator('#account-trigger').click();await page.locator('#edit-profile').click();await page.locator('#profile-name').waitFor();assert.equal(await page.locator('#profile-name').inputValue(),account.name);await page.screenshot({animations:'disabled',path:`${out}/profile-${width}.png`});await page.keyboard.press('Escape');await page.locator('#profile-dialog').waitFor({state:'hidden'});
 const nav=async id=>{if(width<=900&&!['overview','transactions'].includes(id)){await page.locator('#mobile-nav [data-section=more]').click();await page.locator(`#more-nav [data-section=${id}]`).click();}else await page.locator(`${width<=900?'#mobile-nav':'#desktop-nav'} [data-section=${id}]`).click();await page.waitForFunction(expected=>document.querySelector('#dashboard-view').dataset.section===expected,id);};
 await page.locator('#quick-income').click();assert.equal(await page.locator('#transaction-type').inputValue(),'receita');await page.locator('#cancel-dialog').click();
 await nav('transactions');await page.locator('#filter-form').waitFor({state:'visible'});
 await page.locator('#transaction-rows .danger').first().click();await page.locator('#confirm-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#confirm-cancel').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.locator('#confirm-accept').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');await page.locator('#confirm-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#confirm-dialog').isVisible(),false);if(nativeMode){await page.locator('#transaction-rows .danger').first().click();await page.locator('#confirm-dialog').waitFor({state:'visible'});await page.evaluate(()=>{document.getElementById('confirm-dialog').returnValue='confirm'});await page.evaluate(fs.readFileSync('../android-native/app/src/main/assets/dashboard-back.js','utf8'));await page.locator('#confirm-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#confirm-dialog').evaluate(el=>el.returnValue),'cancel');}
 await page.locator('#new-transaction').click();await page.screenshot({animations:'disabled',path:`${out}/form-${width}.png`});await page.keyboard.press('Escape');await page.locator('#transaction-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#transaction-dialog').isVisible(),false);
 await nav('income');await page.waitForFunction(()=>document.querySelector('#filter-type').value==='receita');await page.locator('#clear-filters').click();await page.waitForFunction(()=>!document.querySelector('#dashboard-view').hasAttribute('aria-busy'));assert.equal(await page.locator('#filter-type').inputValue(),'receita');
 await nav('categories');assert.equal(await page.locator('#category-panel').isVisible(),true);
 await nav('reports');assert.equal(await page.locator('#history-panel').isVisible(),true);
 await nav('settings');assert.equal(await page.locator('#settings-panel').isVisible(),true);
 await page.locator('#motion-toggle').click();assert.equal(await page.locator('html').getAttribute('data-motion'),'off');await page.locator('#motion-toggle').click();
 if(nativeMode){await page.locator('#native-update-card').waitFor();await page.locator('#native-update-card button').click();await page.waitForFunction(()=>window.__nativeCommands.includes('update'));await page.locator('#native-check-updates').click();}

 await page.locator('#open-tutorial').click();assert.equal(await page.locator('#tutorial-guide').isVisible(),true);await page.locator('#finish-tutorial').click();
 empty=true;await nav('transactions');await page.waitForFunction(()=>!document.querySelector('#dashboard-view').hasAttribute('aria-busy'));assert.equal(await page.locator('#empty-state').isVisible(),true);await page.screenshot({animations:'disabled',path:`${out}/empty-${width}.png`});
 fail=true;await page.locator('#clear-filters').click();await page.locator('#page-message.error').waitFor();assert.equal(await page.locator('#income-total').innerText(),'—');await page.screenshot({animations:'disabled',path:`${out}/error-${width}.png`});
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.card').first().evaluate(el=>getComputedStyle(el).animationName),'none');
 await nav('settings');await page.locator('#logout').click();await page.locator('#login-view').waitFor({state:'visible'});assert.equal(await page.locator('#password').getAttribute('type'),'password');
 assert.equal(await page.locator('#username').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
 if(nativeMode){await page.waitForFunction(()=>window.__nativeCommands.includes('logout'));const commands=await page.evaluate(()=>window.__nativeCommands);assert(commands.includes('sync'));assert(commands.includes('ready'));}await page.emulateMedia({reducedMotion:'no-preference'});const frameTiming=await page.evaluate(async()=>{
 const motion=await import('/motion.js');const results={};
 for(const enabled of [false,true]){
  motion.setMotionEnabled(enabled);const samples=[];let last;
  for(let i=0;i<31;i++)await new Promise(resolve=>requestAnimationFrame(now=>{if(last!==undefined)samples.push(now-last);last=now;if(enabled)motion.reveal(document.querySelector('#login-view'));resolve();}));
  samples.sort((a,b)=>a-b);results[enabled?'on':'off']={p50_ms:samples[15],p95_ms:samples[28],frames:samples.length};
 }
 motion.setMotionEnabled(true);return results;
 });result.push({width,passed:true,frameTiming});await context.close();
}
await browser.close();fs.writeFileSync(`${out}/results.json`,JSON.stringify({result,errors},null,2));assert.deepEqual(errors,[]);console.log(JSON.stringify({result,errors,output:out},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
