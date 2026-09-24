const DEFAULT_MODEL = 'jev-1.13';
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_UNDERSTOOD_MIN = 0.90;
const DEFAULT_SAFE_MIN = 0.97;
const DEFAULT_FULFILLED_MIN = 0.85;
const MAX_STATE_TEXT = 12000;

export class JevError extends Error {
  constructor(message = 'Jev unavailable', cause) {
    super(message);
    this.name = 'JevError';
    this.cause = cause;
  }
}

function numberEnv(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function jevConfig(env = process.env) {
  return {
    enabled: env.JEV_ENABLED === 'true',
    mode: env.JEV_MODE === 'gate' ? 'gate' : 'shadow',
    model: String(env.JEV_MODEL || DEFAULT_MODEL),
    timeoutMs: Math.max(500, numberEnv(env, 'JEV_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)),
    understoodMin: Math.min(1, Math.max(0, numberEnv(env, 'JEV_UNDERSTOOD_MIN', DEFAULT_UNDERSTOOD_MIN))),
    safeMin: Math.min(1, Math.max(0, numberEnv(env, 'JEV_SAFE_MIN', DEFAULT_SAFE_MIN))),
    fulfilledMin: Math.min(1, Math.max(0, numberEnv(env, 'JEV_FULFILLED_MIN', DEFAULT_FULFILLED_MIN))),
  };
}

function trimText(value, max = 1600) {
  return String(value || '').slice(0, max);
}

function compactTransaction(transaction = {}) {
  return {
    id: transaction.id,
    transaction_type: transaction.transaction_type,
    amount: transaction.amount,
    category: transaction.category,
    description: trimText(transaction.description, 180),
    transaction_date: transaction.transaction_date,
  };
}

function compactState(state) {
  const value = {
    request: {
      text: trimText(state.input?.text, 3000),
      kind: state.input?.kind || 'text',
      attachment: trimText(state.input?.attachment, 5000),
    },
    proposal: {
      action: state.proposal?.operation?.action,
      operation: state.proposal?.operation,
      reply: trimText(state.proposal?.text, 2000),
    },
    context: {
      transactions: (state.context?.transactions || []).slice(0, 100).map(compactTransaction),
      reminders: (state.context?.reminders || []).slice(0, 50).map((item) => ({
        id: item.id,
        short_code: item.short_code,
        kind: item.kind,
        description: trimText(item.description, 180),
        amount: item.amount,
        category: item.category,
        due_date: item.due_date,
        transaction_date: item.transaction_date,
      })),
    },
    actual_result: state.result ? {
      status: state.result.status,
      result: state.result.result,
    } : undefined,
    evaluation: state.evaluation,
    deterministic_checks: state.deterministicChecks || {},
  };
  return JSON.stringify(value).slice(0, MAX_STATE_TEXT);
}

function answerObject(answers, name) {
  const answer = answers?.[name];
  return answer && typeof answer === 'object' ? answer : {};
}

function probability(answers, name) {
  const answer = answerObject(answers, name);
  const value = Number(answer.noul ?? answer.probability ?? answer.score);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

function choice(answers, name) {
  const answer = answerObject(answers, name);
  const value = answer.choice ?? answer.value ?? answer.label ?? answer.answer;
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (value && typeof value === 'object') return String(value.value ?? value.label ?? '').trim().toLowerCase();
  return '';
}

function normalizeRoute(value) {
  if (value === 'execute' || value === 'clarify' || value === 'confirmation' || value === 'fallback') return value;
  if (value === 'ask_clarification' || value === 'clarification') return 'clarify';
  if (value === 'request_confirmation' || value === 'confirm') return 'confirmation';
  if (value === 'fallback_to_n8n' || value === 'fallback_llm' || value === 'review') return 'fallback';
  return '';
}

function compactUsage(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== 'object') return {};
  return {
    input_tokens: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : undefined,
    output_tokens: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : undefined,
    cost: Number.isFinite(Number(usage.cost)) ? Number(usage.cost) : undefined,
  };
}

export function normalizeJevAnswers(payload, { kind = 'gate', model = DEFAULT_MODEL, latencyMs = 0 } = {}) {
  const answers = payload?.answers && typeof payload.answers === 'object' ? payload.answers : {};
  const result = {
    model: String(payload?.model || model),
    route: normalizeRoute(choice(answers, 'next_step')),
    understood: probability(answers, 'request_understood'),
    safe: probability(answers, 'safe_to_execute'),
    fulfilled: probability(answers, 'fulfilled'),
    truthful: probability(answers, 'reply_truthful'),
    usage: compactUsage(payload),
    latency_ms: Math.max(0, Number(latencyMs) || 0),
    decision_kind: kind,
  };
  if (!result.route && kind === 'quality') result.route = 'fallback';
  return result;
}

export async function callJev(state, questions, { env = process.env, fetchImpl = fetch, kind = 'gate' } = {}) {
  const config = jevConfig(env);
  if (!config.enabled) return { status: 'disabled', decision: null };
  if (!env.OPENROUTER_API_KEY) return { status: 'error', error: 'Jev não configurado.' };
  const started = Date.now();
  try {
    const response = await fetchImpl('https://openrouter.ai/api/v1/systemone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: config.model, state: compactState(state), questions }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new JevError('Jev request failed');
    return { status: 'ok', decision: normalizeJevAnswers(payload, { kind, model: config.model, latencyMs: Date.now() - started }) };
  } catch (error) {
    return { status: 'error', error: error instanceof JevError ? error.message : 'Jev indisponível.' };
  }
}

export const GATE_QUESTIONS = {
  request_understood: {
    type: 'noul',
    instructions: 'A proposta interpreta corretamente o pedido original do usuário?',
  },
  safe_to_execute: {
    type: 'noul',
    instructions: 'A proposta é segura para ser validada e executada pelo servidor, sem inventar valores, IDs, permissões ou evidências de pagamento?',
  },
  next_step: {
    type: 'choice',
    instructions: 'Qual deve ser o próximo passo do assistente?',
    criteria: {
      execute: 'A proposta está clara, segura e pode seguir para a validação financeira do servidor.',
      clarify: 'Falta uma informação essencial ou há ambiguidade que exige pergunta ao usuário.',
      confirmation: 'A operação precisa de confirmação explícita do usuário.',
      fallback: 'O n8n precisa revisar a interpretação antes de qualquer operação.',
    },
  },
};

export const QUALITY_QUESTIONS = {
  fulfilled: {
    type: 'noul',
    instructions: 'Considerando o pedido original e o resultado real, a resposta cumpriu a solicitação do usuário?',
  },
  reply_truthful: {
    type: 'noul',
    instructions: 'A resposta descreve com precisão o que realmente aconteceu no servidor, sem afirmar uma alteração que não ocorreu?',
  },
};

export async function decideProposal(state, options = {}) {
  return callJev(state, GATE_QUESTIONS, { ...options, kind: 'gate' });
}

export async function evaluateResult(state, options = {}) {
  return callJev(state, QUALITY_QUESTIONS, { ...options, kind: 'quality' });
}

export function gateAllows(decision, env = process.env) {
  const config = jevConfig(env);
  return decision?.route === 'execute'
    && Number(decision.understood) >= config.understoodMin
    && Number(decision.safe) >= config.safeMin;
}

export function gateRequestsConfirmation(decision, env = process.env) {
  const config = jevConfig(env);
  return decision?.route === 'confirmation'
    && Number(decision.understood) >= config.understoodMin
    && Number(decision.safe) >= config.safeMin;
}

export function qualityNeedsRepair(decision, env = process.env) {
  const config = jevConfig(env);
  return Number(decision?.fulfilled) < config.fulfilledMin || Number(decision?.truthful) < config.fulfilledMin;
}

export function decisionMessage(decision) {
  if (decision?.route === 'confirmation') return 'Antes de continuar, preciso da sua confirmação para esta operação.';
  if (decision?.route === 'fallback') return 'Ainda não consegui validar este pedido com segurança. Pode confirmar o valor, a data e o que aconteceu?';
  return 'Preciso de mais uma informação para registrar isso com segurança. Pode confirmar o valor, a data e o que aconteceu?';
}
