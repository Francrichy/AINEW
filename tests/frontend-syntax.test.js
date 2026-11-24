import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('inline JavaScript in public HTML pages parses', () => {
  const dir = path.resolve('public');
  const pages = readdirSync(dir).filter(name => name.endsWith('.html'));
  for (const page of pages) {
    const html = readFileSync(path.join(dir, page), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    scripts.forEach((match, index) => {
      const attributes = match[1] || '';
      const source = (match[2] || '').trim();
      if (!source || /\bsrc\s*=|type\s*=\s*["']module["']/i.test(attributes)) return;
      assert.doesNotThrow(() => new vm.Script(source, { filename: page + '#script-' + index }), page + ' inline script ' + index);
    });
  }
});
