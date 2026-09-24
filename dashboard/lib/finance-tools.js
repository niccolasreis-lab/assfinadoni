import { rpc, uuid, validatedTransaction } from './server.js';
import { validateReminderCreate } from './reminders.js';
import { featureEnabled } from './flags.js';

export class FinanceToolError extends Error {
  constructor(message, code = 'TOOL_ERROR', status = 400) { super(message); this.code = code; this.status = status; }
}

const requireContext = (context) => {
  if (!context?.userId || !context?.accountId) throw new FinanceToolError('Contexto financeiro inválido.', 'UNAUTHORIZED', 401);
  return context;
};
const optionalDate = (value) => value == null ? null : String(value);
const limit = (value) => {
  const n = Number(value ?? 100);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new FinanceToolError('Limite inválido.', 'INVALID_ARGUMENT');
  return n;
};

export const TOOL_DEFINITIONS = Object.freeze({
  get_balance: { mutating: false, description: 'Consulta o resumo real de receitas, despesas e saldo.' },
  get_accounts: { mutating: false, description: 'Lista contas e carteiras do usuário.' },
  get_transactions: { mutating: false, description: 'Consulta lançamentos reais com filtros.' },
  search_transactions: { mutating: false, description: 'Busca lançamentos por texto, período, tipo ou categoria.' },
  create_transaction: { mutating: true, description: 'Cria um lançamento validado.' },
  update_transaction: { mutating: true, description: 'Atualiza um lançamento pertencente ao usuário.' },
  delete_transaction: { mutating: true, confirmationRequired: true, description: 'Envia um lançamento para a lixeira.' },
  get_credit_cards: { mutating: false, description: 'Lista cartões cadastrados.' },
  get_card_statement: { mutating: false, description: 'Consulta faturas cadastradas.' },
  get_installments: { mutating: false, description: 'Consulta parcelas futuras e pagas.' },
  get_subscriptions: { mutating: false, description: 'Consulta assinaturas detectadas ou cadastradas.' },
  get_budget: { mutating: false, description: 'Consulta orçamento por período e categoria.' },
  get_spending_summary: { mutating: false, description: 'Resume gastos reais por período.' },
  compare_periods: { mutating: false, description: 'Compara dois períodos reais.' },
  get_upcoming_payments: { mutating: false, description: 'Consulta compromissos futuros.' },
  create_reminder: { mutating: true, description: 'Cria um lembrete ou conta futura.' },
  get_financial_insights: { mutating: false, description: 'Consulta insights produzidos pelo sistema.' },
  get_cashflow_projection: { mutating: false, description: 'Consulta projeções explicitamente estimadas.' },
  get_investments: { mutating: false, description: 'Consulta investimentos informados pelo usuário.' },
  get_net_worth: { mutating: false, description: 'Consulta patrimônio calculado a partir dos dados cadastrados.' },
});

function unavailable(name) { throw new FinanceToolError(`A ferramenta ${name} ainda não está habilitada.`, 'FEATURE_UNAVAILABLE', 503); }

export async function executeFinanceTool(name, rawArgs = {}, rawContext, dependencies = {}) {
  const context = requireContext(rawContext);
  const definition = TOOL_DEFINITIONS[name];
  if (!definition) throw new FinanceToolError('Ferramenta desconhecida.', 'UNKNOWN_TOOL', 404);
  if (definition.confirmationRequired && context.confirmed !== true) throw new FinanceToolError('Confirmação explícita necessária.', 'CONFIRMATION_REQUIRED', 409);
  const requiredFlag = { get_budget: 'ENABLE_BUDGETS', get_financial_insights: 'ENABLE_AI_AGENTS', get_investments: 'ENABLE_INVESTMENTS', get_net_worth: 'ENABLE_INVESTMENTS', get_cashflow_projection: 'ENABLE_FORECAST' }[name];
  if (requiredFlag && !featureEnabled(requiredFlag)) return unavailable(name);
  const call = dependencies.rpc || rpc;
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
  switch (name) {
    case 'get_balance':
      return call('finance_balance_summary', { p_user_id: context.userId, p_date_from: optionalDate(args.date_from), p_date_to: optionalDate(args.date_to) });
    case 'get_accounts':
      return call('finance_account_list', { p_user_id: context.userId });
    case 'get_transactions':
    case 'search_transactions':
      return call('finance_transactions_query', { p_user_id: context.userId, p_search: args.search == null ? null : String(args.search), p_date_from: optionalDate(args.date_from), p_date_to: optionalDate(args.date_to), p_type: args.type == null ? null : String(args.type), p_category: args.category == null ? null : String(args.category), p_limit: limit(args.limit) });
    case 'create_transaction': {
      const tx = validatedTransaction(args);
      return call('finance_dashboard_create_transaction', { p_account_id: context.accountId, p_transaction_type: tx.transaction_type, p_amount: tx.amount, p_category: tx.category, p_description: tx.description, p_transaction_date: tx.transaction_date });
    }
    case 'update_transaction': {
      const tx = validatedTransaction(args);
      return call('finance_dashboard_update_transaction', { p_account_id: context.accountId, p_transaction_id: uuid(args.id), p_transaction_type: tx.transaction_type, p_amount: tx.amount, p_category: tx.category, p_description: tx.description, p_transaction_date: tx.transaction_date });
    }
    case 'delete_transaction':
      return call('finance_dashboard_delete_transaction', { p_account_id: context.accountId, p_transaction_id: uuid(args.id) });
    case 'get_credit_cards':
      return call('finance_card_list', { p_user_id: context.userId });
    case 'get_card_statement':
      return call('finance_card_statement_list', { p_user_id: context.userId, p_credit_card_id: args.card_id == null ? null : uuid(args.card_id) });
    case 'get_installments':
      return call('finance_installment_list', { p_user_id: context.userId, p_plan_id: args.plan_id == null ? null : uuid(args.plan_id) });
    case 'get_subscriptions':
      return call('finance_subscription_list', { p_user_id: context.userId });
    case 'get_budget':
      return call('finance_budget_summary', { p_user_id: context.userId, p_budget_id: args.budget_id == null ? null : uuid(args.budget_id), p_date_from: optionalDate(args.date_from), p_date_to: optionalDate(args.date_to) });
    case 'get_spending_summary':
      return call('finance_balance_summary', { p_user_id: context.userId, p_date_from: optionalDate(args.date_from), p_date_to: optionalDate(args.date_to) });
    case 'compare_periods':
      return Promise.all([
        call('finance_balance_summary', { p_user_id: context.userId, p_date_from: optionalDate(args.first_date_from), p_date_to: optionalDate(args.first_date_to) }),
        call('finance_balance_summary', { p_user_id: context.userId, p_date_from: optionalDate(args.second_date_from), p_date_to: optionalDate(args.second_date_to) }),
      ]).then(([first, second]) => ({ first, second }));
    case 'get_cashflow_projection':
      return call('finance_cashflow_projection', { p_user_id: context.userId, p_horizon_days: Number(args.days ?? 30) });
    case 'get_upcoming_payments':
      return call('finance_timeline', { p_user_id: context.userId, p_date_from: optionalDate(args.date_from), p_date_to: optionalDate(args.date_to), p_limit: limit(args.limit) });
    case 'create_reminder':
      return call('finance_reminder_create', { p_user_id: context.userId, p_values: validateReminderCreate(args) });
    case 'get_financial_insights':
      return call('finance_insight_list', { p_user_id: context.userId, p_limit: limit(args.limit) });
    case 'get_investments':
      return call('finance_investment_list', { p_user_id: context.userId });
    case 'get_net_worth':
      return call('finance_net_worth', { p_user_id: context.userId });
    default:
      return unavailable(name);
  }
}
