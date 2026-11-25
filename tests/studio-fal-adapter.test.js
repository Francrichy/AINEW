import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInput, modelPath, normalizeSupplierPrice } from '../studio-fal-adapter.js';

test('fal model IDs are converted into safe queue paths', () => {
  assert.equal(modelPath('fal-ai/speech-to-text'), 'fal-ai/speech-to-text');
  assert.throws(() => modelPath('https://attacker.example/x'));
  assert.throws(() => modelPath('../bad/model'));
});

test('fal input templates replace supported placeholders recursively', () => {
  const result = makeInput(JSON.stringify({ prompt: '{{prompt}}', seconds: '{{durationSeconds}}', options: [{ ratio: '{{aspectRatio}}' }] }), {
    prompt: 'A coffee advert', durationSeconds: 10, aspectRatio: '9:16'
  });
  assert.deepEqual(result, { prompt: 'A coffee advert', seconds: 10, options: [{ ratio: '9:16' }] });
});

test('fal input templates reject invalid JSON and non-object roots', () => {
  assert.throws(() => makeInput('{bad json', {}));
  assert.throws(() => makeInput('[]', {}));
});

test('fal supplier prices convert to TZS and apply the exact x3.5 markup', () => {
  assert.deepEqual(normalizeSupplierPrice('image', 'image', 0.02, 2600), {
    providerCost: 52, customerPrice: 182, factor: 1, unit: 'image'
  });
  assert.deepEqual(normalizeSupplierPrice('video', 'second', 0.05, 2600), {
    providerCost: 650, customerPrice: 2275, factor: 5, unit: 'second'
  });
  assert.deepEqual(normalizeSupplierPrice('voice', 'seconds', 0.001, 2600), {
    providerCost: 156, customerPrice: 546, factor: 60, unit: 'seconds'
  });
});

test('fal supplier pricing refuses units that cannot safely map to app billing units', () => {
  assert.throws(() => normalizeSupplierPrice('voice', '1000 characters', 0.1, 2600), /haiwezi kulinganishwa/);
  assert.throws(() => normalizeSupplierPrice('image', 'megapixel', 0.005, 2600), /haiwezi kulinganishwa/);
  assert.throws(() => normalizeSupplierPrice('image', 'image', 0.02, 0), /si sahihi/);
});
