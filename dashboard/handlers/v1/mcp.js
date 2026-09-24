import { readBody, requireAccount, rpc, sameOrigin, send } from '../../lib/server.js';
import { featureEnabled, requireFeature } from '../../lib/flags.js';
import { executeFinanceTool, TOOL_DEFINITIONS } from '../../lib/finance-tools.js';

export default async function handler(req, res) {
  try {
    requireFeature('ENABLE_MCP');
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method === 'GET') return send(res, 200, { protocol: 'finance-tools-v1', tools: TOOL_DEFINITIONS });
    if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const input = readBody(req);
    const name = String(input.tool || '');
    const args = input.arguments && typeof input.arguments === 'object' ? input.arguments : {};
    const result = await executeFinanceTool(name, args, { userId: account.finance_user_id, accountId: account.id, confirmed: input.confirmed === true }, { rpc });
    await rpc('finance_audit_write', {
      p_user_id: account.finance_user_id,
      p_origin: 'MCP',
      p_action: TOOL_DEFINITIONS[name]?.mutating ? (input.confirmed === true ? 'USER_CONFIRMATION' : 'AI_ACTION') : 'AI_ACTION',
      p_entity_type: 'mcp_tool',
      p_entity_id: null,
      p_account_id: account.id,
      p_request_id: input.request_id || null,
      p_before: null,
      p_after: null,
      p_metadata: { tool: name, feature_enabled: featureEnabled('ENABLE_MCP') },
    });
    return send(res, 200, { result });
  } catch (error) {
    return send(res, error.status || 400, { error: error.message || 'Pedido inválido.', code: error.code || 'REQUEST_ERROR' });
  }
}
