import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
const publicUrl = new URL('../public/', import.meta.url);
const text = file => readFileSync(new URL(file, publicUrl), 'utf8');
test('PWA manifest has real, correctly-sized PNG install icons', () => {
  const manifest = JSON.parse(text('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const icon of manifest.icons) {
    const png = readFileSync(new URL(icon.src.slice(1), publicUrl));
    assert.equal(png.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
    assert.equal(png.readUInt32BE(20), Number(icon.sizes.split('x')[1]));
  }
});
test('service worker never intercepts APIs, mutations, financial scripts or third-party data', () => {
  const events = {};
  vm.runInNewContext(text('sw.js'), {
    URL,
    self: { location: { origin: 'https://finance.test' }, addEventListener: (name, callback) => { events[name] = callback; } }
  });
  for (const [path, method] of [['/api/session', 'GET'], ['/api/transactions', 'GET'], ['/api/shares', 'DELETE'], ['/app.js', 'GET'], ['/styles.css', 'GET'], ['https://elsewhere.test/offline.html', 'GET']]) {
    let intercepted = false;
    events.fetch({ request: { url: new URL(path, 'https://finance.test').href, method, mode: 'cors' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});
test('offline fallback contains no financial app or authentication code', () => {
  const offline = text('offline.html');
  assert.doesNotMatch(offline, /app\.js|\/api\/|password|transaction-rows/);
  assert.match(offline, /Nenhuma alteração/);
  assert.match(text('sw.js'), /cache: 'no-store'/);
  assert.doesNotMatch(text('sw.js'), /cache\.put/);
});
test('Vercel permits first-party PWA only and prevents stale worker caching', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const global = config.headers.find(entry => entry.source === '/(.*)').headers;
  assert.match(global.find(header => header.key === 'Content-Security-Policy').value, /worker-src 'self'; manifest-src 'self'/);
  assert.match(config.headers.find(entry => entry.source === '/sw.js').headers[0].value, /no-store/);
  assert.ok(existsSync(new URL('pwa.js', publicUrl)));
});

test('push messages are private even when the incoming payload contains financial details', async () => {
  const events={},shown=[];
  vm.runInNewContext(text('sw.js'),{URL,self:{location:{origin:'https://finance.test'},addEventListener:(name,fn)=>events[name]=fn,registration:{showNotification:async(title,options)=>shown.push({title,options})}}});
  let pending;
  events.push({data:{json:()=>({title:'Private account',body:'R$ 9.999 debt',url:'https://evil.test',tag:'unsafe<tag>'})},waitUntil:p=>pending=p});
  await pending;
  assert.equal(shown[0].title,'Assistente de Finanças');
  assert.doesNotMatch(shown[0].options.body,/9\.999|debt|Private/);
  assert.equal(shown[0].options.data.url,'/?reminders=1');
  assert.equal(shown[0].options.tag,'finance-pending');
});

test('notification click focuses an existing app without losing an unsaved form', async () => {
  const events={},messages=[];let focused=false,opened=false,closed=false;
  vm.runInNewContext(text('sw.js'),{URL,self:{location:{origin:'https://finance.test'},addEventListener:(name,fn)=>events[name]=fn,clients:{matchAll:async()=>[{url:'https://finance.test/',focus:async()=>{focused=true;},postMessage:x=>messages.push(x)}],openWindow:async()=>{opened=true;}}}});
  let pending;events.notificationclick({notification:{close:()=>{closed=true;},data:{url:'https://evil.test'}},waitUntil:p=>pending=p});await pending;
  assert.equal(closed,true);assert.equal(focused,true);assert.equal(opened,false);assert.equal(messages[0].type,'OPEN_REMINDERS');
});
