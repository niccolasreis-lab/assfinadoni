import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { rpc, supabase, uuid } from '../lib/server.js';
import { extractMedia, telegramFile, MediaError } from './media.js';
import { interpret, repairResponse } from './interpret.js';
import { decisionMessage, decideProposal, evaluateResult, gateAllows, gateRequestsConfirmation, jevConfig, qualityNeedsRepair } from './jev.js';

const MUTATING_ACTIONS = new Set(['create', 'update', 'delete', 'reminder', 'complete_reminder']);

export function isMutatingAction(action) { return MUTATING_ACTIONS.has(action); }

function jevQualityPayload({gateResult, qualityResult, repaired=false}) {
  const gate=gateResult?.decision||{};
  const quality=qualityResult?.decision||{};
  return {
    status:qualityResult?.status||'disabled',
    model:quality.model||gate.model||null,
    route:gate.route||null,
    understood:gate.understood,
    safe:gate.safe,
    fulfilled:quality.fulfilled,
    truthful:quality.truthful,
    repaired:Boolean(repaired),
    latency_ms:Number(gate.latency_ms||0)+Number(quality.latency_ms||0),
    cost:Number(gate.usage?.cost||0)+Number(quality.usage?.cost||0),
  };
}

async function recordQuality(call,job,quality,text) {
  try {
    return await call('finance_assistant_record_quality',{p_id:job.id,p_quality:quality,p_text:text||null});
  } catch {
    console.error('Assistant worker: Jev evaluation could not be recorded.');
    return null;
  }
}

export async function processJob(job,{database=supabase,call=rpc,extract=extractMedia,download=telegramFile,analyze=interpret,decide=decideProposal,evaluate=evaluateResult,repair=repairResponse}={}) {
  let transcript='';
  let input;
  let context={transactions:[],reminders:[],actual_outcomes:[]};
  let proposal;
  let gateResult={status:'disabled',decision:null};
  let confirmationRequested=false;
  try {
    input={user_id:job.user_id,text:job.payload.text||'',kind:'text'};
    if(job.payload.file || job.payload.telegram_file_id) {
      const bytes=job.payload.file?Buffer.from(job.payload.file.base64,'base64'):await download(job.payload.telegram_file_id);
      const result=await extract(bytes,{photo:job.payload.media_kind==='photo'});
      transcript=result.text; input={...input,kind:result.kind,attachment:transcript};
      await database(`finance_assistant_jobs?id=eq.${job.id}&lease_token=eq.${job.lease_token}`,{method:'PATCH',body:{file_hash:createHash('sha256').update(bytes).digest('hex')}});
    }
    if(job.payload.action) proposal={operation:{action:'chat'},text:''};
    else {
      const query=new URLSearchParams({select:'id,transaction_type,amount,category,description,transaction_date',user_id:`eq.${job.user_id}`,deleted_at:'is.null',order:'created_at.desc',limit:'100'});
      const [transactions,reminders,outcomes]=await Promise.all([
        database(`finance_transactions?${query}`),
        database(`finance_reminders?${new URLSearchParams({select:'id,short_code,kind,description,amount,category,due_date,transaction_date',finance_user_id:`eq.${job.user_id}`,status:'eq.pending',order:'created_at.desc',limit:'50'})}`),
        database(`finance_assistant_jobs?${new URLSearchParams({select:'result',user_id:`eq.${job.user_id}`,status:'in.(done,failed,awaiting_confirmation)',order:'created_at.desc',limit:'8'})}`),
      ]);
      const target=input.text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0];
      if(target && !transactions.some(t=>t.id===target)) {
        const extra=await database(`finance_transactions?${new URLSearchParams({select:'id,transaction_type,amount,category,description,transaction_date',user_id:`eq.${job.user_id}`,id:`eq.${uuid(target)}`,deleted_at:'is.null',limit:'1'})}`);
        transactions.push(...extra);
      }
      context={transactions,reminders,actual_outcomes:outcomes.map(o=>o.result).reverse()};
      proposal=await analyze(input,context);
    }
    if(isMutatingAction(proposal.operation?.action)) {
      const deterministicChecks={operation_valid:Boolean(proposal.operation),mutation:true,server_validation:'finance_assistant_finish'};
      gateResult=await decide({input,proposal,context,deterministicChecks});
      const config=jevConfig();
      if(config.enabled && config.mode==='gate' && gateResult.status==='ok' && gateResult.decision?.route==='fallback') {
        try {
          const reviewed=await analyze(input,{...context,jev_review:{decision:gateResult.decision,proposal:proposal.operation}});
          if(isMutatingAction(reviewed.operation?.action)) {
            const reviewedGate=await decide({input,proposal:reviewed,context,deterministicChecks});
            if(reviewedGate.status==='ok' && gateAllows(reviewedGate.decision)) {
              proposal=reviewed;gateResult=reviewedGate;
            } else proposal={operation:{action:'chat'},text:decisionMessage(reviewedGate.decision)};
          } else proposal=reviewed;
        } catch { proposal={operation:{action:'chat'},text:decisionMessage(gateResult.decision)}; }
      }
      if(config.enabled && config.mode==='gate' && (gateResult.status==='error' || (gateResult.status==='ok' && !gateAllows(gateResult.decision)))) {
        if(gateResult.status==='ok' && gateRequestsConfirmation(gateResult.decision)) {
          confirmationRequested=true;
          proposal={operation:{...proposal.operation,requires_confirmation:true},text:decisionMessage(gateResult.decision)};
        } else proposal={operation:{action:'chat'},text:decisionMessage(gateResult.decision)};
      }
    }
    const finished=await call(confirmationRequested?'finance_assistant_request_confirmation':'finance_assistant_finish',{p_id:job.id,p_lease:job.lease_token,p_operation:proposal.operation,p_text:proposal.text,p_transcript:transcript});
    const config=jevConfig();
    if(!config.enabled || !finished || finished.status==='failed' && proposal.operation?.action==='error') return finished;
    const qualityResult=await evaluate({input,proposal,context,result:finished,gate:gateResult});
    if(qualityResult.status==='disabled') return finished;
    let repaired=false;
    let finalText=null;
    if(config.mode==='gate' && qualityResult.status==='ok' && qualityNeedsRepair(qualityResult.decision)) {
      try {
        const repairedProposal=await repair({input,proposal,context,result:finished,quality:qualityResult.decision});
        if(repairedProposal?.text) { repaired=true; finalText=repairedProposal.text; }
      } catch { /* A telemetry failure must not change a completed financial result. */ }
    }
    const quality=jevQualityPayload({gateResult,qualityResult,repaired});
    if(qualityResult.status==='error') quality.error='Jev indisponível.';
    const recorded=await recordQuality(call,job,quality,finalText);
    return recorded||finished;
  } catch(error) {
    // A failed/uncertain commit is safe: finish is atomic and returns an existing final result.
    return call('finance_assistant_finish',{p_id:job.id,p_lease:job.lease_token,p_operation:{action:'error'},
      p_text:error instanceof MediaError?error.message:'Não consegui concluir com segurança. Confira seus lançamentos antes de tentar novamente.',p_transcript:transcript});
  }
}

async function deliver(job) {
  const rows=await supabase(`finance_users?${new URLSearchParams({select:'telegram_chat_id',id:`eq.${job.user_id}`,limit:'1'})}`);
  const chat=rows[0]?.telegram_chat_id;
  if(!chat) return;
  const result=job.result||{};
  const rowsText=(result.transactions||[]).map(t=>`${t.description} · ${Number(t.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} · ${t.transaction_date}${t.id?`\nCódigo: ${t.id}`:''}`).join('\n');
  let text=[result.transcript?`Entendi: ${result.transcript.slice(0,700)}`:'',result.text,rowsText].filter(Boolean).join('\n\n');
  if(result.confirmation_id) text+=`\n\n/confirmar ${result.confirmation_id}\n/cancelar_ai ${result.confirmation_id}`;
  else if(result.transactions?.some(t=>t.id&&!t.deleted_at)) text+='\n\nPara corrigir, diga “altere o valor para ...”. Para excluir, diga “exclua esse lançamento”.';
  const response=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text:text.slice(0,4000)}),signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok||!data.ok) throw new Error('Delivery failed');
  await supabase(`finance_assistant_jobs?id=eq.${job.id}&delivery_lease_until=eq.${encodeURIComponent(job.delivery_lease_until)}`,{method:'PATCH',body:{delivered_at:new Date().toISOString()}});
}

export async function main() {
  for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','N8N_ASSISTANT_URL','N8N_ASSISTANT_SECRET']) if(!process.env[key]) throw new Error(`Missing configuration: ${key}`);
  let stopping=false; for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{stopping=true;});
  while(!stopping) {
    let work=false;
    try {
      const job=await rpc('finance_assistant_claim',{});
      if(job) { work=true; await processJob(job); }
      if(process.env.TELEGRAM_BOT_TOKEN) { const delivery=await rpc('finance_assistant_delivery_claim',{}); if(delivery) {work=true;await deliver(delivery);} }
    } catch { console.error('Assistant worker: operation unavailable; retrying.'); }
    if(!work) await delay(2000);
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(()=>{console.error('Assistant worker configuration invalid.');process.exitCode=1;});
