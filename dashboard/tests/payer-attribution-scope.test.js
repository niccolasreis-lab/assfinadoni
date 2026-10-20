import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../lib/payer-attribution-scope.js';
import { payerAttributionScopeCases } from './helpers/payer-scope-cases.js';

for (const [name, run] of payerAttributionScopeCases(assert, api)) test(name, run);
