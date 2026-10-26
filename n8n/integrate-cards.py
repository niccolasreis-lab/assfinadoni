"""Patch an intact current n8n export; does not connect or publish credentials."""
import copy,json,sys
from pathlib import Path

def integrate(workflow):
    w=copy.deepcopy(workflow)
    nodes={n['name']:n for n in w['nodes']}
    p=nodes['Classificar comando']['parameters']
    code=p['jsCode']
    if 'function namedCardPayment' in code: raise ValueError('Card patch already applied')
    helper=Path(__file__).with_name('card-metadata.js').read_text()
    old="const withMetadata = (tx, category, payment) => ({...tx,category:category || tx.category || 'Outros',payment_details:payment || tx.payment_details || {}});"
    assert old in code
    code=code.replace(old,helper+"\nconst withMetadata = (tx, category, payment) => ({...tx,category:category || tx.category || 'Outros',payment_details:mergePaymentMetadata(tx.payment_details,payment)});")
    old="const pay=['pix','dinheiro','debito','cartao'].includes(ai.payment_method)?paymentFrom(ai.payment_method):null;"
    assert old in code
    code=code.replace(old,"let pay=['pix','dinheiro','debito','cartao'].includes(ai.payment_method)?paymentFrom(ai.payment_method):null;\n  if(ai.card_name!=null){try{pay=namedCardPayment(pay||(rows.length===1?rows[0].payment_details:null),ai.card_name,currentText);}catch(e){return human(e.message,'aguardando_confirmacao');}}")
    old="  const payer=payerProposal(draft);"
    assert old in code
    code=code.replace(old,"  let checkedPayment;try{checkedPayment=namedCardPayment(pay,draft.card_name,currentText);}catch(e){return human(e.message,'aguardando_confirmacao');}\n"+old)
    code=code.replace('payment_details:pay||{},payer:expensePayer','payment_details:checkedPayment||{},payer:expensePayer')
    old='if(source.transaction_date!=null)'
    assert old in code
    code=code.replace(old,"  if(source.card_name!=null){try{changes.payment_details=namedCardPayment(changes.payment_details||target.payment_details,source.card_name,currentText);}catch(e){return human(e.message,'gestao_edicao');}}\n"+old)
    code=code.replace("k==='payment_details'?v.method:v","k==='payment_details'?v.method+(v.card_name?' · '+v.card_name:''):v")
    code=code.replace("tx.payment_details?.method?', '+tx.payment_details.method:''","tx.payment_details?.method?', '+tx.payment_details.method+(tx.payment_details.card_name?' · '+tx.payment_details.card_name:''):''")
    code=code.replace("t.payment_details?.method?', '+t.payment_details.method:''","t.payment_details?.method?', '+t.payment_details.method+(t.payment_details.card_name?' · '+t.payment_details.card_name:''):''")
    p['jsCode']=code
    prompt=nodes['AI Agent · intenção financeira']['parameters']['options']['systemMessage']
    prompt+='\n\nNOME DO CARTÃO. Preserve card_name como string ou null em cada new_transactions, na raiz para confirmar/ajustar proposta e em management.changes para edição. Use SOMENTE nome ou apelido explicitamente informado pela pessoa (ex.: "cartão de crédito Nubank" => payment_method:"cartao",card_name:"Nubank"). Não infira cartão pelo banco de um favorecido, Pix, estabelecimento ou pagamento de fatura. Não invente limite, bandeira, vencimento, número ou pagador. Não copie número completo, CVV nem senha. Sem menção explícita use null, preservando o cartão da proposta anterior. "Sim. Cartão de crédito Nubank, lazer" confirma uma proposta existente e informa cartão Nubank e categoria Lazer; não cria outra compra. Um pedido para trocar cartão de lançamento existente é edição, com confirmação, nunca nova despesa. Alterações de categoria ou descrição não apagam o cartão já identificado.'
    nodes['AI Agent · intenção financeira']['parameters']['options']['systemMessage']=prompt
    n=nodes['Criar lançamento']
    n['type']='n8n-nodes-base.httpRequest';n['typeVersion']=4.2
    n['parameters']={'method':'POST','url':'https://jhpappaakmdfxyujnlef.supabase.co/rest/v1/rpc/finance_whatsapp_record_transaction','authentication':'predefinedCredentialType','nodeCredentialType':'supabaseApi','sendBody':True,'specifyBody':'json','jsonBody':"={{ JSON.stringify({p_user_id:$('Processar compras').item.json.userId,p_event_id:$('Processar compras').item.json.sourceEventId,p_legacy_key:$('Processar compras').item.json.recordKey,p_values:$('Processar compras').item.json.tx,p_confirmed:$('Processar compras').item.json.pendingConfirmation===true}) }}",'options':{'timeout':30000}}
    nodes['Resultado do registro']['parameters']['jsCode']="""const current=$('Processar compras').item.json;
const row=$input.first().json;
const valid=!!row.id&&row.user_id===current.userId&&row.external_event_id===current.sourceEventId&&!row.deleted_at&&Number(row.amount)===Number(current.tx.amount);
return [{json:{...current,tx:valid?{...current.tx,payment_details:row.payment_details||{}}:current.tx,status:valid?(row._idempotent_replay===true?'duplicado':'registrado'):'falha',attributionEligible:valid&&row.transaction_type==='despesa'&&row.source==='API',savedId:valid?row.id:null,error:valid?null:String(row.error?.message||row.error||'O banco não confirmou o registro').slice(0,240)}}];"""
    code=nodes['Confirmar lançamento']['parameters']['jsCode']
    old="tx.payment_details.method==='pix'?'Pix':tx.payment_details.method"
    assert old in code
    nodes['Confirmar lançamento']['parameters']['jsCode']=code.replace(old,"(tx.payment_details.method==='pix'?'Pix':tx.payment_details.method)+(tx.payment_details.card_name?' · '+tx.payment_details.card_name:'')")
    return w

if __name__=='__main__':
    out=Path(sys.argv[2]);out.write_text(json.dumps(integrate(json.loads(Path(sys.argv[1]).read_text())),ensure_ascii=False));out.chmod(0o600)
    print('Card metadata and atomic event RPC configured; not published')
