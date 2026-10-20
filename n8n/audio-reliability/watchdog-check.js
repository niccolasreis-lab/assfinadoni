// Only inspect the single parent execution supplied by the finance workflow.
const ctx = $('Receber acompanhamento').first().json;
const response = $input.first().json;
const statusCode = Number(response.statusCode || 200);
const execution = response.body || response;
if (statusCode !== 200 || execution.workflowId !== ctx.workflowId || String(execution.id) !== String(ctx.executionId)) return [];
const runs = execution.data?.resultData?.runData || {};
const delivered = (runs['Responder WhatsApp'] || []).some(run => !run.error && run.data?.main?.[0]?.some(item => item.json?.key?.id));
if (delivered || ['success', 'canceled'].includes(execution.status)) return [];
// Never claim a financial operation failed: a write may already have committed.
const failed = ['error', 'crashed'].includes(execution.status);
const atFinalCheck = $('Checagem final?').isExecuted;
if (!failed && atFinalCheck) return [];
return [{json:{...ctx,kind:failed?'failure':'progress',replyText:failed
 ? 'Não consegui concluir a resposta ao seu áudio. Antes de reenviar um pagamento, confira os lançamentos para evitar duplicidade. Se preferir, escreva o pedido em texto.'
 : 'Recebi seu áudio e ainda estou processando. Está demorando mais que o esperado; vou continuar tentando e avisar se não conseguir.'}}];
