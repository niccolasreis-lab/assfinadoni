const sent=$input.item.json;
if(sent.error||!(sent.key?.id||sent.message?.key?.id))return null;
let context,reply;
try{context=$('Preparar contexto seguro').first().json;reply=$('Preparar menção individual').item.json;}catch{return null;}
let mode='default';
try{
 if($('AI Agent · intenção financeira').isExecuted){
  const raw=$('AI Agent · intenção financeira').first().json.output;
  const value=typeof raw==='string'?JSON.parse(raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')):raw;
  if(value&&typeof value==='object'&&!Array.isArray(value)&&['audio','text','default'].includes(value.response_mode))mode=value.response_mode;
 }
}catch{}
if(mode==='text')return null;
let report=null;
try{if($('Confirmar preferência financeira').isExecuted)report=$('Confirmar preferência financeira').first().json;}catch{}
const automatic=report?.reportReady===true&&report.spokenReport===true&&typeof report.reportBody==='string'&&Boolean(report.reportBody.trim());
if(mode!=='audio'&&!automatic)return null;
const body=typeof reply.replyText==='string'?reply.replyText:'';
if(!context.user?.id||!context.messageId||!context.chatId||!body.trim()||body.length>5000)return null;
return {json:{userId:context.user.id,chatId:context.chatId,source_message_id:context.messageId,body,explicit_voice:mode==='audio'||report?.explicitVoice===true,responseMode:mode}};
