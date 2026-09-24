import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function prepareAssistant(source,{headerCredentialId,headerCredentialName='Finance Assistant Internal',apiUrl='https://assfinadoni.vercel.app/api/assistant-telegram'}={}) {
  if(!headerCredentialId) throw new Error('Provide an n8n httpHeaderAuth credential ID (x-assistant-secret).');
  const current=structuredClone(source);
  const original=current.nodes.find(n=>n.name==='Modelo OmniRoute');
  if(!original || !current.nodes.some(n=>n.name==='Decidir estado do usuário')) throw new Error('Expected financial workflow not found.');
  const settings={executionOrder:'v1',saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false,timezone:'America/Sao_Paulo'};
  const credentials={httpHeaderAuth:{id:headerCredentialId,name:headerCredentialName}};
  const nodes=[
    {id:'assistant-webhook',name:'Receber pedido autenticado',type:'n8n-nodes-base.webhook',typeVersion:2,position:[0,0],webhookId:'finance-assistant',credentials,parameters:{httpMethod:'POST',path:'finance-assistant',authentication:'headerAuth',responseMode:'lastNode',options:{}}},
    {id:'assistant-input',name:'Preparar conversa',type:'n8n-nodes-base.set',typeVersion:3.4,position:[240,0],parameters:{assignments:{assignments:[{id:'session',name:'sessionKey',type:'string',value:'={{ $json.body.sessionKey }}'},{id:'text',name:'text',type:'string',value:'={{ $json.body.text }}'},{id:'system',name:'systemPrompt',type:'string',value:'={{ $json.body.systemPrompt }}'}]},options:{}}},
    {id:'assistant-ai',name:'Agente Financeiro Compartilhado',type:'@n8n/n8n-nodes-langchain.agent',typeVersion:3.1,position:[480,0],parameters:{promptType:'define',text:'={{ $json.text }}',options:{systemMessage:'={{ $json.systemPrompt }}'}}},
    {...structuredClone(original),id:'assistant-model',position:[400,240]},
    {id:'assistant-memory',name:'Memória compartilhada · 8 trocas',type:'@n8n/n8n-nodes-langchain.memoryBufferWindow',typeVersion:1.3,position:[640,240],parameters:{sessionIdType:'customKey',sessionKey:"={{ $('Preparar conversa').first().json.sessionKey }}",contextWindowLength:8}},
  ];
  const edge=(node,type='main')=>({node,type,index:0});
  const shared={name:'Assistente Financeiro · dashboard e Telegram',nodes,connections:{
    'Receber pedido autenticado':{main:[[edge('Preparar conversa')]]},'Preparar conversa':{main:[[edge('Agente Financeiro Compartilhado')]]},
    [original.name]:{ai_languageModel:[[edge('Agente Financeiro Compartilhado','ai_languageModel')]]},
    'Memória compartilhada · 8 trocas':{ai_memory:[[edge('Agente Financeiro Compartilhado','ai_memory')]]},
  },settings};
  // Preserve onboarding, /saldo, notification commands and scheduler connections.
  const route=current.connections['É consulta antes da IA?']?.main;
  if(!route?.[1]) throw new Error('Expected AI route not found.');
  current.nodes.push({id:'assistant-enqueue',name:'Enviar ao assistente compartilhado',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[1400,1100],credentials,onError:'continueRegularOutput',parameters:{method:'POST',url:apiUrl,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:"={{ JSON.stringify({chat_id:$('Decidir estado do usuário').first().json.chatId,update_id:$('Decidir estado do usuário').first().json.messageId,text:$('Decidir estado do usuário').first().json.text,telegram_file_id:$('Decidir estado do usuário').first().json.fileId||undefined,media_kind:$('Decidir estado do usuário').first().json.mediaKind}) }}",options:{timeout:20000}}});
  current.nodes.push({id:'assistant-ack',name:'Confirmar recebimento',type:'n8n-nodes-base.code',typeVersion:2,position:[1640,1100],parameters:{jsCode:"const x=$input.first().json; return [{json:{chatId:$('Decidir estado do usuário').first().json.chatId,replyText:x.text||'Não consegui receber seu pedido. Tente novamente em instantes.'}}];"}});
  route[1]=[edge('Enviar ao assistente compartilhado')];
  current.connections['Enviar ao assistente compartilhado']={main:[[edge('Confirmar recebimento')]]};
  current.connections['Confirmar recebimento']={main:[[edge('Enviar resposta Telegram')]]};
  return {shared,telegram:{name:current.name,nodes:current.nodes,connections:current.connections,settings:{...current.settings,...settings}}};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [sourcePath,out,credentialId]=process.argv.slice(2);
  if(!sourcePath||!out||!credentialId) throw new Error('Usage: node configure-assistant-n8n.mjs live-backup.json output-directory header-credential-id');
  const result=prepareAssistant(JSON.parse(fs.readFileSync(sourcePath,'utf8')),{headerCredentialId:credentialId});
  fs.mkdirSync(out,{recursive:true,mode:0o700});
  for(const [name,value] of Object.entries(result))fs.writeFileSync(path.join(out,`${name}.json`),JSON.stringify(value,null,2),{mode:0o600});
  console.log('Prepared shared and Telegram workflows. No live changes performed.');
}
