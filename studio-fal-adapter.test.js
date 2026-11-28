import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInput, normalizeSupplierPrice, modelPath } from './studio-fal-adapter.js';

test('makeInput keeps typed values and omits optional blank media URLs', () => {
  const input = makeInput(JSON.stringify({
    prompt: '{{prompt}}',
    duration: '{{durationSeconds}}',
    resolution: '{{resolution}}',
    image_url: '{{imageUrl}}',
    target_audio_url: '{{audioUrl}}',
    aspect_ratio: '{{aspectRatio}}'
  }), {
    prompt: 'A presenter waves to camera',
    durationSeconds: 15,
    resolution: '768P',
    imageUrl: '',
    audioUrl: '',
    aspectRatio: '9:16'
  });
  assert.equal(input.prompt, 'A presenter waves to camera');
  assert.equal(input.duration, 15);
  assert.equal(input.resolution, '768P');
  assert.equal(input.aspect_ratio, '9:16');
  assert.equal(Object.hasOwn(input, 'image_url'), false);
  assert.equal(Object.hasOwn(input, 'target_audio_url'), false);
});

test('fal.ai ElevenLabs TTS price is normalized per 1,000 characters', () => {
  const price = normalizeSupplierPrice('voice', '1000 characters', 0.1, 2600);
  assert.equal(price.providerCost, 260);
  assert.equal(price.customerPrice, 1040);
});

test('fal.ai per-character TTS pricing converts to a 1,000-character unit', () => {
  const price = normalizeSupplierPrice('voice', 'character', 0.0001, 2600);
  assert.equal(price.providerCost, 260);
  assert.equal(price.customerPrice, 1040);
});

test('H3 Max Lip Sync per-second supplier price converts correctly', () => {
  const price = normalizeSupplierPrice('avatar_video', 'seconds', 0.08, 2600);
  assert.equal(price.providerCost, 208);
  assert.equal(price.customerPrice, 832);
});

test('modelPath accepts fal.ai endpoint IDs and rejects invalid IDs', () => {
  assert.equal(modelPath('minimax/h3-max/lip-sync/image-to-video'), 'minimax/h3-max/lip-sync/image-to-video');
  assert.throws(() => modelPath('https://example.com/model'));
});
