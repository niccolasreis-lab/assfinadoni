function namedCardPayment(payment, name, evidence) {
  if (name == null || name === '') return payment;
  if (typeof name !== 'string') throw Error('Qual é o nome ou apelido do cartão?');
  const label = name.replace(/\s+/g, ' ').trim();
  const normalized = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!label || label.length > 80 || !/^[\p{L}\p{N} .&()/'-]+$/u.test(label) || /\d[\d .-]{10,}\d/.test(label)) throw Error('Informe apenas o nome ou apelido do cartão.');
  if (!normalized(evidence).includes(normalized(label))) throw Error('Qual cartão foi usado? Preciso do nome informado por você.');
  if (!payment || !['cartao', 'misto'].includes(payment.method)) throw Error('Esse pagamento foi feito no cartão?');
  const result = { ...payment, card_name: label };
  delete result.credit_card_id;
  return result;
}

function mergePaymentMetadata(previous = {}, payment) {
  if (!payment) return previous;
  const result = { ...previous, ...payment };
  if (!['cartao', 'misto'].includes(result.method)) { delete result.card_name; delete result.credit_card_id; }
  else if (payment.card_name && payment.card_name !== previous.card_name) delete result.credit_card_id;
  return result;
}
