import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiProviderCatalog } from '../ai-provider-registry.js';

test('provider catalog distinguishes configured credentials from working integrations', () => {
  const catalog = buildAiProviderCatalog({
    LIVEAVATAR_API_KEY: 'live-secret',
    LIVEAVATAR_ETHAN_AVATAR_ID: 'ethan-id',
    POLLINATIONS_API_KEY: 'pollinations-secret',
    OPENROUTER_API_KEY: 'openrouter-secret',
    VIDEO_PROVIDER: 'pollinations',
    ELEVENLABS_API_KEY: 'eleven-secret'
  });
  const live = catalog.providers.find(p => p.id === 'liveavatar');
  const pollinations = catalog.providers.find(p => p.id === 'pollinations');
  const eleven = catalog.providers.find(p => p.id === 'elevenlabs');
  assert.equal(live.ready, true);
  assert.equal(pollinations.ready, true);
  assert.equal(pollinations.selected, true);
  assert.equal(eleven.credentialConfigured, true);
  assert.equal(eleven.ready, true);
  assert.equal(eleven.services.includes('music_generation'), true);
  assert.equal(catalog.services.find(s => s.id === 'music_generation').available, true);
  const serialized = JSON.stringify(catalog);
  for (const secret of ['live-secret', 'pollinations-secret', 'openrouter-secret', 'eleven-secret']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(catalog.providers.every(p => typeof p.credentialName === 'string'), true);
});

test('provider selection respects configured video provider', () => {
  const catalog = buildAiProviderCatalog({
    OPENROUTER_API_KEY: 'secret',
    VIDEO_PROVIDER: 'openrouter'
  });
  assert.equal(catalog.providers.find(p => p.id === 'openrouter-video').selected, true);
  assert.equal(catalog.providers.find(p => p.id === 'pollinations').selected, false);
});
