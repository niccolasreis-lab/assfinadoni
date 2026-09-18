const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
const base=process.env.QA_URL||'http://127.0.0.1:4173',out='/tmp/finance-profile-qa';fs.mkdirSync(out,{recursive:true});
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
try{for(const width of [360,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));let account={id:'account-a',username:'qa_profile',name:'Conta de teste'},profile={display_name:'Conta de teste',avatar_data_url:null},saves=0;
 await page.addInitScript(()=>localStorage.setItem('finance_tutorial_v1_qa_profile','seen'));
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/session')return route.fulfill({json:{authenticated:true,account}});
  if(path==='/api/profile'){
   if(request.method()==='PATCH'){saves++;profile={...profile,...request.postDataJSON()};}
   return route.fulfill({json:{profile,account:{...account,display_name:profile.display_name}}});
  }
  return route.fulfill({json:{account,transactions:[],summary:{income:0,expense:0,balance:0,byCategory:{}},pagination:{hasMore:false}}});
 });
 await page.goto(base);await page.locator('#account-trigger').click();await page.locator('#edit-profile').waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('#edit-profile').disabled);
 await page.screenshot({path:`${out}/menu-${width}.png`,animations:'disabled'});
 await page.locator('#edit-profile').click();await page.locator('#profile-name').fill('Nicolas Teste');
 await page.locator('#profile-save').click();await page.locator('#profile-dialog').waitFor({state:'hidden'});
 assert.equal(await page.locator('#user-name').textContent(),'Nicolas Teste');assert.equal(saves,1);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#user-name').textContent==='Nicolas Teste');
 await page.locator('#account-trigger').click();await page.locator('#edit-profile').click();
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.fillStyle='#7c3aed';x.fillRect(0,0,32,32);return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#profile-photo').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>document.querySelector('#profile-preview img')&&!document.querySelector('#profile-save').disabled);
 await page.locator('#photo-zoom').fill('1.5');await page.screenshot({path:`${out}/editor-${width}.png`,animations:'disabled'});
 await page.locator('#profile-save').click();await page.locator('#profile-dialog').waitFor({state:'hidden'});assert.ok(profile.avatar_data_url.startsWith('data:image/jpeg;base64,'));assert.equal(await page.locator('#account-avatar img').count(),1);
 await page.locator('#account-trigger').click();await page.locator('#edit-profile').click();await page.locator('#remove-photo').click();await page.locator('#profile-save').click();await page.locator('#profile-dialog').waitFor({state:'hidden'});assert.equal(profile.avatar_data_url,null);
 // A cancelled decode must not leave the next editor stuck in a busy state.
 await page.evaluate(()=>{const original=window.createImageBitmap;window.createImageBitmap=async(...args)=>{await new Promise(r=>setTimeout(r,400));return original(...args);};});
 await page.locator('#account-trigger').click();await page.locator('#edit-profile').click();await page.locator('#profile-photo').setInputFiles({name:'slow.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.keyboard.press('Escape');await page.locator('#profile-dialog').waitFor({state:'hidden'});await page.locator('#account-trigger').click();await page.locator('#edit-profile').click();assert.equal(await page.locator('#profile-save').isEnabled(),true);
 await page.locator('#profile-photo').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await page.locator('#profile-error').waitFor({state:'visible'});
 await page.keyboard.press('Escape');await page.locator('#profile-dialog').waitFor({state:'hidden'});
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#account-trigger').click();await page.locator('#edit-profile').click();await page.locator('#profile-cancel').click();await page.locator('#profile-dialog').waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log(JSON.stringify({width,profile:true,photo:true,cancelDecode:true,reducedMotion:true,errors}));await context.close();
}}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
