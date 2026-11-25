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
  assert.equal(pollinations.services.includes('image_generation'), true);
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

test('Studio provider readiness is separate from API-key presence', () => {
  const catalog = buildAiProviderCatalog({
    CARTESIA_API_KEY: 'cartesia-secret',
    DEEPGRAM_API_KEY: 'deepgram-secret',
    STABILITY_API_KEY: 'stability-secret',
    REPLICATE_API_TOKEN: 'replicate-secret'
  });
  for (const id of ['cartesia', 'deepgram', 'stability']) {
    const provider = catalog.providers.find(p => p.id === id);
    assert.equal(provider.integrationStatus, 'active');
    assert.equal(provider.ready, true);
  }
  const replicate = catalog.providers.find(p => p.id === 'replicate');
  assert.equal(replicate.credentialConfigured, true);
  assert.equal(replicate.integrationStatus, 'planned');
  assert.equal(replicate.ready, false);
  assert.equal(catalog.services.find(s => s.id === 'animation').available, false);
  assert.equal(catalog.services.find(s => s.id === 'motion').available, false);
});

test('Runway, Luma and HeyGen readiness follows credentials and keeps animation planned', () => {
  const catalog = buildAiProviderCatalog({
    RUNWAY_API_KEY: 'runway-secret',
    LUMA_AGENTS_API_KEY: 'luma-secret',
    HEYGEN_API_KEY: 'heygen-secret',
    STUDIO_MOTION_PROVIDER: 'luma'
  });
  for (const id of ['runway', 'luma', 'heygen']) {
    const provider = catalog.providers.find(p => p.id === id);
    assert.equal(provider.integrationStatus, 'active');
    assert.equal(provider.ready, true);
  }
  assert.equal(catalog.providers.find(p => p.id === 'luma').selected, true);
  assert.equal(catalog.services.find(s => s.id === 'motion').available, true);
  assert.equal(catalog.services.find(s => s.id === 'avatar_video').available, true);
  assert.equal(catalog.services.find(s => s.id === 'avatar_library').available, true);
  assert.equal(catalog.services.find(s => s.id === 'animation').available, false);
});
