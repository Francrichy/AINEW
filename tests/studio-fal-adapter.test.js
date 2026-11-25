import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInput, modelPath } from '../studio-fal-adapter.js';

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
