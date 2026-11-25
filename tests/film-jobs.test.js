import test from 'node:test';
import assert from 'node:assert/strict';
import { registerFilmJobRoutes } from '../film-jobs.js';

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
