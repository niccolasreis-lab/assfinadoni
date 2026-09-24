import accounts from '../handlers/accounts.js';
import alerts from '../handlers/alerts.js';
import assistantTelegram from '../handlers/assistant-telegram.js';
import assistant from '../handlers/assistant.js';
import budgets from '../handlers/budgets.js';
import cards from '../handlers/cards.js';
import duplicates from '../handlers/duplicates.js';
import forecast from '../handlers/forecast.js';
import goals from '../handlers/goals.js';
import insights from '../handlers/insights.js';
import installments from '../handlers/installments.js';
import investments from '../handlers/investments.js';
import netWorth from '../handlers/net-worth.js';
import reports from '../handlers/reports.js';
import search from '../handlers/search.js';
import splits from '../handlers/splits.js';
import subscriptions from '../handlers/subscriptions.js';
import timeline from '../handlers/timeline.js';
import mcp from '../handlers/v1/mcp.js';
import appTransactions from './transactions.js';
import appReminders from './reminders.js';

const routes = {
  accounts,
  alerts,
  'assistant-telegram': assistantTelegram,
  assistant,
  budgets,
  cards,
  duplicates,
  forecast,
  goals,
  insights,
  installments,
  investments,
  'net-worth': netWorth,
  reports,
  search,
  splits,
  subscriptions,
  timeline,
  'v1/accounts': accounts,
  'v1/alerts': alerts,
  'v1/assistant': assistant,
  'v1/assistant-telegram': assistantTelegram,
  'v1/budgets': budgets,
  'v1/cards': cards,
  'v1/duplicates': duplicates,
  'v1/forecast': forecast,
  'v1/goals': goals,
  'v1/insights': insights,
  'v1/installments': installments,
  'v1/investments': investments,
  'v1/mcp': mcp,
  'v1/net-worth': netWorth,
  'v1/reminders': appReminders,
  'v1/reports': reports,
  'v1/search': search,
  'v1/splits': splits,
  'v1/subscriptions': subscriptions,
  'v1/timeline': timeline,
  'v1/transactions': appTransactions,
};

export default async function handler(req, res) {
  const pathname = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`).pathname;
  const key = pathname.replace(/^\\/api\\//, '').replace(/\\/$/, '');
  const route = routes[key];
  if (!route) return res.status(404).json({ error: 'Rota não encontrada.' });
  return route(req, res);
}
