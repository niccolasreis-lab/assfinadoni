import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../lib/payer-attribution.js';
import { payerAttributionCases } from './helpers/payer-attribution-cases.js';

for (const [name, run] of payerAttributionCases(assert, api)) test(name, run);
