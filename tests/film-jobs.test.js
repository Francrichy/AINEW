import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFilmCharge, registerFilmJobRoutes } from '../film-jobs.js';

test('Long Video Creator bills every generated second without rounding to minutes', () => {
  assert.equal(calculateFilmCharge(600, 2), 1200);
  assert.equal(calculateFilmCharge(1200, 2), 2400);
  assert.equal(calculateFilmCharge(605, 2), 1210);
  assert.equal(calculateFilmCharge(601, 1.5), 902);
});

test('rejects invalid film duration and negative per-second prices', () => {
  assert.throws(() => calculateFilmCharge(0, 10), /Muda wa filamu/);
  assert.throws(() => calculateFilmCharge(60, -1), /bei kwa sekunde/);
});

test('registers authenticated estimate, create, status and download routes', () => {
  const routes = [];
  const app = {
    get: (path, ...handlers) => routes.push(['GET', path, handlers.length]),
    post: (path, ...handlers) => routes.push(['POST', path, handlers.length])
  };
  const db = { exec: () => {}, prepare: () => ({ get: () => ({ customer_price: 0 }) }) };
  registerFilmJobRoutes(app, {
    db,
    need: (_req, _res, next) => next(),
    env: {},
    cashWalletBalance: () => 0,
    consumeWalletCredits: () => {},
    creditCashWallet: () => {}
  });
  assert.deepEqual(routes.map(([method, path]) => method + ' ' + path), [
    'GET /api/studio/film/estimate',
    'POST /api/studio/film/jobs',
    'GET /api/studio/film/jobs/:id',
    'GET /api/studio/film/jobs/:id/download'
  ]);
});

test('film estimate states prepaid token requirement and wallet shortfall before generation', () => {
  const routes = [];
  const app = {
    get: (path, ...handlers) => routes.push(['GET', path, handlers]),
    post: (path, ...handlers) => routes.push(['POST', path, handlers])
  };
  const db = { exec: () => {}, prepare: () => ({ get: () => ({ customer_price: 5 }) }) };
  registerFilmJobRoutes(app, {
    db,
    need: (_req, _res, next) => next(),
    env: {},
    cashWalletBalance: () => 1000,
    consumeWalletCredits: () => {},
    creditCashWallet: () => {}
  });
  const route = routes.find(([method, path]) => method === 'GET' && path === '/api/studio/film/estimate');
  let payload;
  const res = { status() { return this; }, json(value) { payload = value; return this; } };
  route[1][0]({ query: { durationSeconds: '600' }, user: { id: 7 } }, res);
  assert.equal(payload.requiredTokens, 600);
  assert.equal(payload.tokenDefinition, 'Token 1 = sekunde 1 ya video iliyopangwa');
  assert.equal(payload.estimatedChargeTzs, 3000);
  assert.equal(payload.shortfallTzs, 2000);
  assert.equal(payload.paymentRequiredBeforeGeneration, true);
  assert.equal(payload.enabled, false);
});
