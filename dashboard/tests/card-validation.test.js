import assert from 'node:assert/strict';
import test from 'node:test';
import { validatedTransaction } from '../lib/server.js';
const base={transaction_type:'despesa',amount:42.5,category:'Lazer',description:'Compra fixture',transaction_date:'2026-09-24',payment_method:'cartao',installments:1};
test('nome de cartão é opcional, validado e removido ao trocar pagamento',()=>{
 assert.equal(validatedTransaction({...base,card_name:'  Nubank  '}).payment_details.card_name,'Nubank');
 assert.equal(Object.hasOwn(validatedTransaction(base).payment_details,'card_name'),false);
 assert.equal(validatedTransaction({...base,card_name:'Nubank',payment_method:'dinheiro'}).payment_details.card_name,null);
 for(const card_name of [42,{name:'Nubank'},'4111 1111 1111 1111','<script>','a'.repeat(81)])assert.throws(()=>validatedTransaction({...base,card_name}));
});
