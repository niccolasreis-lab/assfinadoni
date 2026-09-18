// Browser-only fixtures. Never shipped in public/ or used by production APIs.
// Run: PLAYWRIGHT_MODULE=/path/to/playwright node scripts/verify-redesign.cjs
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const out=process.env.QA_OUTPUT || '/tmp/finance-redesign-qa';fs.mkdirSync(out,{recursive:true});
const base=process.env.QA_URL || 'http://127.0.0.1:4173';
(async()=>{
const browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
const errors=[]; const result=[];
for(const width of [360,768,1024,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},locale:'pt-BR',serviceWorkers:'block'});const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error' && !(fail && m.text().includes('500 (Internal Server Error)')))errors.push(m.text());});
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
 await page.screenshot({animations:'disabled',path:`${out}/dashboard-${width}.png`,fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);
 const nav=async id=>{if(width<=900&&!['overview','transactions'].includes(id)){await page.locator('#mobile-nav [data-section=more]').click();await page.locator(`#more-nav [data-section=${id}]`).click();}else await page.locator(`${width<=900?'#mobile-nav':'#desktop-nav'} [data-section=${id}]`).click();};
 await page.locator('#quick-income').click();assert.equal(await page.locator('#transaction-type').inputValue(),'receita');await page.locator('#cancel-dialog').click();
 await nav('transactions');await page.locator('#filter-form').waitFor({state:'visible'});
 await page.locator('#transaction-rows .danger').first().click();await page.locator('#confirm-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#confirm-cancel').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.locator('#confirm-accept').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#confirm-dialog').isVisible(),false);
 await page.locator('#new-transaction').click();await page.screenshot({animations:'disabled',path:`${out}/form-${width}.png`});await page.keyboard.press('Escape');assert.equal(await page.locator('#transaction-dialog').isVisible(),false);
 await nav('income');await page.waitForFunction(()=>document.querySelector('#filter-type').value==='receita');await page.locator('#clear-filters').click();await page.waitForFunction(()=>!document.querySelector('#dashboard-view').hasAttribute('aria-busy'));assert.equal(await page.locator('#filter-type').inputValue(),'receita');
 await nav('categories');assert.equal(await page.locator('#category-panel').isVisible(),true);
 await nav('reports');assert.equal(await page.locator('#history-panel').isVisible(),true);
 await nav('settings');assert.equal(await page.locator('#settings-panel').isVisible(),true);
 await page.locator('#open-tutorial').click();assert.equal(await page.locator('#tutorial-guide').isVisible(),true);await page.locator('#finish-tutorial').click();
 empty=true;await nav('transactions');await page.waitForFunction(()=>!document.querySelector('#dashboard-view').hasAttribute('aria-busy'));assert.equal(await page.locator('#empty-state').isVisible(),true);await page.screenshot({animations:'disabled',path:`${out}/empty-${width}.png`});
 fail=true;await page.locator('#clear-filters').click();await page.locator('#page-message.error').waitFor();assert.equal(await page.locator('#income-total').innerText(),'—');await page.screenshot({animations:'disabled',path:`${out}/error-${width}.png`});
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.card').first().evaluate(el=>getComputedStyle(el).animationName),'none');
 await nav('settings');await page.locator('#logout').click();await page.locator('#login-view').waitFor({state:'visible'});assert.equal(await page.locator('#password').getAttribute('type'),'password');
 assert.equal(await page.locator('#username').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
 result.push({width,passed:true});await context.close();
}
await browser.close();fs.writeFileSync(`${out}/results.json`,JSON.stringify({result,errors},null,2));assert.deepEqual(errors,[]);console.log(JSON.stringify({result,errors,output:out},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
