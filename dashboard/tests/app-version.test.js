import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/app-version.js';
test('release discovery remains public metadata and never exposes credentials',()=>{
  const values={ANDROID_VERSION_CODE:'7',ANDROID_VERSION_NAME:'1.4.0',ANDROID_APK_URL:'https://example.test/release.apk',ANDROID_APK_SHA256:'a'.repeat(64),ANDROID_APK_SIZE_BYTES:'123',ANDROID_RELEASE_NOTES:'Correções'};
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  Object.assign(process.env,values);
  try {
    let payload;const headers={};const res={setHeader(k,v){headers[k]=v;},status(code){assert.equal(code,200);return this;},json(value){payload=value;}};
    handler({},res);
    assert.equal(headers['Cache-Control'],'no-store');assert.equal(payload.version_code,7);assert.equal(payload.sha256,values.ANDROID_APK_SHA256);assert.equal(payload.size_bytes,123);assert.equal(payload.release_notes,'Correções');
    assert.deepEqual(Object.keys(payload).sort(),['download_url','release_notes','sha256','size_bytes','version_code','version_name']);
  }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
