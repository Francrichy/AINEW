import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateVoiceMinutes } from '../studio-provider-adapters.js';

test('voice duration estimate rounds up by 150 words per minute and never returns zero', () => {
  assert.equal(estimateVoiceMinutes(''), 1);
  assert.equal(estimateVoiceMinutes(Array(150).fill('neno').join(' ')), 1);
  assert.equal(estimateVoiceMinutes(Array(151).fill('neno').join(' ')), 2);
  assert.equal(estimateVoiceMinutes(Array(301).fill('neno').join(' ')), 3);
});
