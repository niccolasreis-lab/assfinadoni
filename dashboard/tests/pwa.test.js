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
