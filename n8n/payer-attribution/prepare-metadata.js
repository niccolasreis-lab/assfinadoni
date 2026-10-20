const x=$input.first().json;
const payer=x.tx?.payer;
const explicit=x.tx?.payerFrozenVersion===1&&payer&&['participant','joint'].includes(payer.kind);
const financialSaved=['registrado','duplicado'].includes(x.status)&&!!x.savedId;
const confirmed=explicit&&x.pendingConfirmation===true&&x.payerConfirmed===true;
const shouldPersist=confirmed&&financialSaved&&x.attributionEligible===true&&x.tx.transaction_type==='despesa';
return [{json:{...x,shouldPersistPayer:!!shouldPersist,attributionStatus:explicit&&financialSaved?'pending':'not_requested'}}];
