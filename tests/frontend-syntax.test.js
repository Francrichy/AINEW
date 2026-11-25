import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('main customer pages include mobile viewport and responsive layout', () => {
  for (const page of ['index.html', 'studio.html', 'guide.html', 'provider-admin.html']) {
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

test('Studio multi-choice controls use collections and key actions are wired', () => {
  const html = readFileSync(path.join('public', 'studio.html'), 'utf8');
  assert.match(html, /\$\$\('\[data-vtype\]'\)\.forEach/);
  assert.match(html, /\$\$\('\[data-mode\]'\)\.forEach/);
  assert.match(html, /\$\$\('#voiceLog \.bubble'\)\.map/);
  assert.match(html, /id="draftNewsScript"/);
  assert.match(html, /Mlimani Labs Studio/);
  assert.doesNotMatch(html, /(?<!\$)\$\('\[data-vtype\]'\)\.forEach/);
  assert.doesNotMatch(html, /(?<!\$)\$\('\[data-mode\]'\)\.forEach/);
  assert.doesNotMatch(html, /(?<!\$)\$\('#voiceLog \.bubble'\)\.map/);
});

test('Live Talk keeps Ethan and Ngina featured and supports provider avatar selections', () => {
  const html = readFileSync(path.join('public', 'studio.html'), 'utf8');
  const server = readFileSync('server.js', 'utf8');
  assert.match(html, /id="featuredAvatarChoices"/);
  assert.match(html, /data-avatar="Ethan"/);
  assert.match(html, /data-avatar="Ngina"/);
  assert.match(html, /id="liveAvatarCatalogGrid"/);
  assert.match(html, /loadLiveAvatarLibrary\(\)/);
  assert.match(html, /avatarId:selectedLiveAvatarId/);
  assert.match(server, /requestedAvatarId/);
  assert.match(server, /selectedAvatar = catalog\.avatars\.find/);
  assert.match(html, /id="liveLanguage"/);
  assert.match(html, /liveLanguage/);
  assert.match(server, /Never substitute an English-only voice/);
  assert.match(server, /Kiswahili sanifu cha Tanzania/);
  assert.match(server, /Avatar uliyochagua haipatikani au haiko tayari/);
});

test('AI Video offers quality tiers with upfront estimates and Admin-controlled prices', () => {
  const html = readFileSync(path.join('public', 'production-studio.html'), 'utf8');
  const server = readFileSync('server.js', 'utf8');
  const billing = readFileSync('billing.js', 'utf8');
  assert.match(html, /id="videoAvatarQuality"/);
  assert.match(html, /value="realistic"/);
  assert.match(html, /value="stylized"/);
  assert.match(html, /value="cartoon"/);
  assert.match(html, /getVideoEstimate\(\)/);
  assert.match(html, /expectedChargeTzs:estimate\.estimatedChargeTzs/);
  assert.match(server, /app\.get\('\/api\/video\/estimate'/);
  assert.match(server, /video_realistic_5s_tzs/);
  assert.match(server, /video_stylized_5s_tzs/);
  assert.match(server, /video_cartoon_5s_tzs/);
  assert.match(server, /VISUAL AVATAR QUALITY/);
  assert.match(billing, /AI Video – Avatar halisi/);
  assert.match(billing, /AI Video – Avatar ya mtindo/);
  assert.match(billing, /AI Video – Katuni/);
});

test('Live Talk uses realistic provider avatars and does not fall back to sandbox', () => {
  const server = readFileSync('server.js', 'utf8');
  assert.match(server, /LIVEAVATAR_REAL_HUMAN_AVATAR_IDS/);
  assert.match(server, /appearance: 'real-human'/);
  assert.match(server, /Avatar halisi ya .*bado haijaunganishwa/);
  assert.doesNotMatch(server, /let avatarId = LIVEAVATAR_SANDBOX_AVATAR/);
});
