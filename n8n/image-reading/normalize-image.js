const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const plain = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const br = value => Number(value).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
const cents = value => Math.round(Number(value) * 100);
const total = rows => rows.reduce((sum, tx) => sum + cents(tx.amount), 0) / 100;
const paymentFrom = text => {
  const t = plain(text);
  if (/\bpix\b/.test(t)) return {method:'pix'};
  if (/\bdinheiro\b/.test(t)) return {method:'dinheiro'};
  if (/\bdebito\b/.test(t)) return {method:'debito'};
  if (/\b(?:cartao|credito)\b/.test(t)) return {method:'cartao',installments:1,cash_amount:'0.00'};
  return null;
};
const categoryFrom = text => {
  const t = plain(text);
  return [
    [/\bviage(?:m|ns)\b/, 'Viagem'], [/\bcasamento\b/, 'Casamento'],
    [/mercado|supermercado|padaria|restaurante|lanche|comida|ifood|alimenta/, 'Alimentação'],
    [/uber|\b99\b|taxi|combust|gasolina|transporte/, 'Transporte'],
    [/aluguel|condom|\bluz\b|energia|\bagua\b|internet|moradia/, 'Moradia'],
    [/farmacia|medico|consulta|saude/, 'Saúde'], [/curso|escola|faculdade|livro|educacao/, 'Educação'],
    [/cinema|\bbar\b|show|lazer/, 'Lazer'], [/netflix|spotify|assinatura/, 'Assinaturas'],
    [/\boutros\b/, 'Outros'],
  ].find(([pattern]) => pattern.test(t))?.[1] ?? null;
};
const moneyIn = text => {
  const result = [];
  const pattern = /(?<![\p{L}\d.,/])(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\d|[.,]\d|\/\d)/giu;
  for (const m of String(text).matchAll(pattern)) {
    const tail = text.slice(m.index + m[0].length);
    if (/^\s*(?:x\b|vezes\b|parcelas?\b|compras?\b|itens?\b|dias?\b|meses\b|anos?\b)/i.test(tail)) continue;
    const prefix = text.slice(Math.max(0,m.index - 45),m.index);
    const labelled = /(?:valor(?:\s+(?:pago|total|da compra))?|total(?:\s+(?:pago|da compra|do pedido))?)\s*[:\-]?\s*$/i.test(prefix);
    const raw = m[1];
    const amount = Number(raw.includes(',') || /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g,'').replace(',','.') : raw);
    if (Number.isFinite(amount) && amount > 0 && amount <= 100000000) result.push({amount,raw,match:m[0],index:m.index,labelled,currency:/r\$/i.test(m[0]),decimal:/[.,]/.test(raw)});
  }
  const priority = result.some(x=>x.labelled) ? result.filter(x=>x.labelled) : result.some(x=>x.currency) ? result.filter(x=>x.currency) : result.some(x=>x.decimal) ? result.filter(x=>x.decimal) : result;
  return priority.filter((x,i,a)=>a.findIndex(y=>cents(y.amount)===cents(x.amount))===i);
};
const pendingRows = p => Array.isArray(p?.transactions) ? p.transactions : p?.tx ? [p.tx] : [];
const withMetadata = (tx, category, payment) => ({...tx,category:category || tx.category || 'Outros',payment_details:payment || tx.payment_details || {}});

const context=$('Preparar contexto seguro').first().json;
const result=$input.first().json;
const reply=(replyText,verifiedAttachmentProposal=false)=>[{json:{...context,route:'reply',replyText,financialStatus:'aguardando_confirmacao',...(verifiedAttachmentProposal?{verifiedAttachmentProposal:true}:{})}}];
const partsText=content=>typeof content==='string'?content:Array.isArray(content)?content.map(p=>typeof p==='string'?p:typeof p?.text==='string'?p.text:'').join('\n'):'';
const outputParts=Array.isArray(result.output)?result.output.flatMap(item=>Array.isArray(item?.content)?item.content:[]):[];
const refusal=Boolean(result.refusal||result.choices?.[0]?.message?.refusal||outputParts.some(p=>p?.type==='refusal'||p?.refusal));
const content=result.choices?.[0]?.message?.content??result.content??result.message?.content??result.text??result.output_text;
const text=(partsText(content)||partsText(outputParts)||(result.candidates?.[0]?.content?.parts??[]).map(p=>p.text??'').join('\n')).trim();
if(result.error||refusal||!text)return reply('Não consegui ler esse anexo. Envie uma imagem legível ou o valor e a descrição em texto.');
let data;try{data=JSON.parse(text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{return reply('Não consegui identificar os valores com segurança. Envie o valor e a descrição em texto.');}
if(!data||typeof data!=='object'||Array.isArray(data)||!Array.isArray(data.transactions)||!data.transactions.length)return reply('Não identifiquei uma compra com valor nesse anexo. Envie o valor e a descrição em texto.');
if(data.transactions.length>10)return reply('Há muitas compras nesse anexo. Envie até dez compras por vez para eu conferir.');
if(data.transactions.some(tx=>!tx||typeof tx!=='object'||Array.isArray(tx)||!['despesa','receita'].includes(tx.transaction_type)))return reply('Não consegui validar uma compra nesse anexo com segurança. Envie o valor e a descrição em texto.');
if(data.transactions.some(tx=>typeof tx.amount!=='number'||!Number.isFinite(tx.amount)||tx.amount<=0||tx.amount>100000000))return reply('Há uma compra com valor incerto nesse anexo. Envie uma imagem legível ou os valores em texto.');
const validDate=value=>{if(value==null||value==='')return true;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number(value.slice(0,4))>=1&&!isNaN(d)&&d.toISOString().slice(0,10)===value;};
if(data.transactions.some(tx=>!validDate(tx.transaction_date)))return reply('Não consegui validar a data de uma compra nesse anexo. Envie uma imagem mais nítida ou me conte o valor, a descrição e a data para eu conferir.');
const transactions=data.transactions.map(item=>{
 const description=clean(item.description).slice(0,180)||'Despesa';
 return {transaction_type:item.transaction_type==='receita'?'receita':'despesa',amount:item.amount.toFixed(2),description,category:categoryFrom(description)||'Outros',transaction_date:typeof item.transaction_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(item.transaction_date)?item.transaction_date:context.today,payment_details:paymentFrom(item.payment_method??'')||{}};
});
const state=$getWorkflowStaticData('global');state.pending??={};
state.pending[context.chatId]={transactions,sourceMessageId:context.messageId,at:Date.now()};
const lines=transactions.map(tx=>`• ${br(tx.amount)} — ${tx.description}`);
const dateNote=data.transactions.some(tx=>tx.transaction_date==null||tx.transaction_date==='')?'\nData não visível: usando hoje ('+context.today+'). Confirme ou informe outra data.':'';
return reply(`Identifiquei ${transactions.length} compra(s):\n${lines.join('\n')}\nTotal: ${br(total(transactions))}.${dateNote}\nPosso registrar ${transactions.length>1?'todas':'essa compra'}? Se quiser, me conte também a categoria e como foi o pagamento.`,true);

