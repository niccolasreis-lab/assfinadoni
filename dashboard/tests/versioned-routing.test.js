import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import router from '../api/[...route].js';
const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
function response(){return {statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;}};}
test('Vercel encaminha APIs versionadas sem adicionar funções e mantém autenticação',async()=>{
 assert(config.rewrites.some(r=>r.source==='/api/v1/:path*'&&r.destination==='/api/:path*'));
 for(const path of ['/api/cards','/api/v1/cards','/api/couple','/api/v1/couple']){
  const res=response();await router({method:'GET',url:path,headers:{host:'dashboard.example'},query:{}},res);
  assert.equal(res.statusCode,401,path);
  assert.equal(res.body.error,'Faça login para continuar.');
 }
});
