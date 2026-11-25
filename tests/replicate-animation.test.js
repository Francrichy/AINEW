import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplicateInput } from '../studio-async-provider-adapters.js';

test('Replicate input templates safely substitute prompt, image and numeric duration values', () => {
  const input = buildReplicateInput(
    '{"prompt":"{{prompt}}","image":"{{imageUrl}}","frames":"{{durationSeconds}}","ratio":"{{aspectRatio}}"}',
    { prompt: 'A cartoon bird flies', imageUrl: 'https://example.com/start.png', durationSeconds: 10, aspectRatio: '16:9' }
  );
  assert.deepEqual(input, {
    prompt: 'A cartoon bird flies',
    image: 'https://example.com/start.png',
    frames: 10,
    ratio: '16:9'
  });
});

test('Replicate input templates must be JSON objects with a prompt placeholder', () => {
  assert.throws(() => buildReplicateInput('not-json', { prompt: 'hello' }));
  assert.throws(() => buildReplicateInput('{"text":"hello"}', { prompt: 'hello' }), /prompt placeholder/);
});
