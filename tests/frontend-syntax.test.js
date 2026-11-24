import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('main customer pages include mobile viewport and responsive layout', () => {
  for (const page of ['index.html', 'studio.html', 'guide.html']) {
    const html = readFileSync(path.join('public', page), 'utf8');
    assert.match(html, /<meta\s+name=["']viewport["']/i, page + ' must define a mobile viewport');
    assert.match(html, /@media\s*\(/i, page + ' must include responsive styles');
  }
});

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
