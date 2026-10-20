import assert from 'node:assert/strict';
import test from 'node:test';
import couple from '../handlers/couple.js';
import { setSession } from '../lib/server.js';
process.env.SESSION_SECRET='segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL='https://teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='chave-falsa';
const account={id:'11111111-1111-4111-8111-111111111111',username:'member',session_version:1,active:true,finance_user_id:'22222222-2222-4222-8222-222222222222'};
let cookie; setSession({setHeader(_n,v){cookie=v.split(';')[0];}},account);
const headers={cookie};
const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;}});

test('API Casal usa conta da sessão, rejeita escrita e filtros inválidos e respeita negação do banco',async()=>{
  const original=globalThis.fetch; const calls=[]; let allowed=true;
  globalThis.fetch=async(url,options)=>{
    if(new URL(url).pathname.endsWith('/dashboard_accounts')) return {ok:true,status:200,json:async()=>[account]};
    calls.push(JSON.parse(options.body));
    return allowed ? {ok:true,status:200,json:async()=>({transactions:[],summary:{income:0,expense:0,balance:0},readOnly:true})} : {ok:false,status:403,json:async()=>({code:'42501'})};
  };
  try {
    const ok=response(); await couple({method:'GET',headers,query:{month:'2026-10',p_account_id:'forged',finance_user_id:'forged'}},ok);
    assert.equal(ok.statusCode,200); assert.equal(calls[0].p_account_id,account.id); assert.equal(calls[0].p_values.finance_user_id,undefined);
    const write=response(); await couple({method:'DELETE',headers,query:{}},write); assert.equal(write.statusCode,405); assert.equal(calls.length,1);
    for(const query of [{month:'2026-13'},{page:'0'},{view:'everything'},{date_from:'2026-02-31'},{q:['x']},{type:'transfer'}]){
      const invalid=response(); await couple({method:'GET',headers,query},invalid); assert.equal(invalid.statusCode,400);
    }
    assert.equal(calls.length,1);
    const anon=response(); await couple({method:'GET',headers:{},query:{}},anon); assert.equal(anon.statusCode,401);
    allowed=false; const denied=response(); await couple({method:'GET',headers,query:{month:'2026-10'}},denied); assert.equal(denied.statusCode,403);
  } finally {globalThis.fetch=original;}
});
