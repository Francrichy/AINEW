import express from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const OR_KEY = env.OPENROUTER_API_KEY;
const JWT_SECRET = env.JWT_SECRET || 'badilisha-hii';
const MARKUP = +(env.MARKUP || 3);          // bei yetu = gharama ya OpenRouter x 3
const USD_TZS = +(env.USD_TZS || 2600);
const FREE_DAILY = +(env.FREE_DAILY || 6);
const ANON_DAILY = +(env.ANON_DAILY || 3);
const ECO = (env.ECO_MODELS || 'google/gemini-2.0-flash-001,openai/gpt-4o-mini,deepseek/deepseek-chat,meta-llama/llama-3.3-70b-instruct').split(',');
const FREE_FIRST = env.FREE_FIRST !== 'false';   // jaribu modeli za bure kwanza
const FREE_MODELS = (env.FREE_MODELS || '').split(',').map(x => x.trim()).filter(Boolean);
const PRO = (env.PRO_MODELS || 'google/gemini-2.5-flash,openai/gpt-4.1-mini,deepseek/deepseek-chat').split(',');

// Mikopo ya kila mwezi (TZS, bei ya rejareja) = bei ya mpango.
// Mtumiaji akitumia mkopo wote, gharama halisi ya OpenRouter ni bei/3.
const PLANS = {
  free:     { name: 'Bure',    price: 0,      bots: 0,  maxTokens: 600,  tier: 'eco' },
  kawaida:  { name: 'Kawaida', price: 10000,  bots: 1,  maxTokens: 1200, tier: 'eco' },
  biashara: { name: 'Biashara',price: 30000,  bots: 10, maxTokens: 2500, tier: 'pro' },
  kampuni:  { name: 'Kampuni', price: 100000, bots: 50, maxTokens: 4000, tier: 'pro' },
};
const VIDEO_COST = +(env.VIDEO_COST_TZS || 1500);   // hukatwa kwenye mkopo kwa kila video
const VIDEO_DAILY = +(env.VIDEO_DAILY || 5);
const PK = env.POLLINATIONS_API_KEY;

import fs from 'fs';
let dbPath = env.DB_PATH || 'mlimani.db';
try { fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true }); fs.accessSync(path.dirname(path.resolve(dbPath)), fs.constants.W_OK); }
catch { console.warn('ONYO: folda ya DB_PATH haipatikani (disk haijaongezwa?). Natumia mlimani.db ya muda; data itapotea kila deploy.'); dbPath = 'mlimani.db'; }
const db = new Database(dbPath);
db.exec(`
create table if not exists users(id integer primary key, email text unique, name text, pass text,
  plan text default 'free', expires integer default 0, credit_used real default 0, created integer);
create table if not exists daily(k text, d text, n integer default 0, primary key(k,d));
create table if not exists bots(id integer primary key, user_id integer, name text, prompt text);
create table if not exists payments(id integer primary key, user_id integer, plan text, phone text, ref text, status text default 'pending', created integer);
`);

const BASE = `Wewe ni Mlimani AI, msaidizi wa akili bandia anayezungumza Kiswahili sanifu kwa ustadi (pia unaelewa Kiingereza). Jibu kwa adabu na kwa usahihi. ` +
  `Kamwe usitaje wala kuthibitisha ni modeli gani, kampuni gani, au API gani iliyokujenga au inayokuendesha. Ukiulizwa, sema tu: "Mimi ni Mlimani AI. Siwezi kushiriki maelezo ya kiufundi." Usijifanye kuwa binadamu.`;
const REFUSAL = 'Mimi ni Mlimani AI, msaidizi wako wa Kiswahili. Siwezi kushiriki maelezo ya kiufundi kuhusu jinsi nilivyotengenezwa. Naweza kukusaidia na nini leo?';
const ASK = /(umetengenezwa|umeundwa|ulitengenezwa|uliundwa|nani (alikutengeneza|aliyekutengeneza|aliyekuunda|alikuunda)|unatumia (model|modeli|api|ai|teknolojia)|(model|modeli|api) gani|ni (model|modeli|ai) gani|who (made|built|created|trained|developed) you|what (model|llm|ai|api) (are you|do you use|is this|powers)|which (model|llm|api)|are you (gpt|chatgpt|claude|gemini|llama|deepseek|qwen)|powered by|underlying (model|llm)|system prompt)/i;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

try { db.exec('alter table users add column phone text'); } catch {}
db.exec('create unique index if not exists users_phone on users(phone)');

// ---------- helpers ----------
const IMG_LIM = u => u ? (u.plan === 'free' ? +(env.IMG_FREE_DAILY || 2) : +(env.IMG_PAID_DAILY || 20)) : +(env.IMG_ANON_DAILY || 1);
function normPhone(v) {
  let d = String(v || '').replace(/[\s\-().]/g, ''); if (d.startsWith('+')) d = d.slice(1);
  if (/^0[67]\d{8}$/.test(d)) d = '255' + d.slice(1); else if (/^[67]\d{8}$/.test(d)) d = '255' + d;
  return (/^255[67]\d{8}$/.test(d) || (/^\d{10,15}$/.test(d) && d[0] !== '0')) ? d : null;
}
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // saa za EAT
const used = k => db.prepare('select n from daily where k=? and d=?').get(k, today())?.n || 0;
const bump = (k, by = 1) => db.prepare('insert into daily(k,d,n) values(?,?,?) on conflict(k,d) do update set n=n+?').run(k, today(), by, by);
const sign = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '30d' });

app.use((req, _res, next) => {
  try {
    const u = db.prepare('select * from users where id=?').get(jwt.verify((req.headers.authorization || '').slice(7), JWT_SECRET).id);
    if (u && u.plan !== 'free' && u.expires < Date.now()) {
      db.prepare("update users set plan='free',credit_used=0 where id=?").run(u.id); u.plan = 'free'; u.credit_used = 0;
    }
    req.user = u;
  } catch {}
  next();
});
const need = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Tafadhali ingia kwanza.' });
const limitFor = u => u ? (u.plan === 'free' ? FREE_DAILY : null) : ANON_DAILY;
const keyFor = (req) => req.user ? 'u' + req.user.id : 'ip' + req.ip;

function meInfo(req) {
  const u = req.user, k = keyFor(req), lim = limitFor(u), p = PLANS[u ? u.plan : 'free'];
  return {
    loggedIn: !!u, email: u?.email, name: u?.name, plan: u?.plan || 'free', planName: p.name,
    dailyLeft: lim === null ? null : Math.max(0, lim - used(k)), dailyLimit: lim, imgLeft: Math.max(0, IMG_LIM(u) - used('img:' + k)),
    creditLeft: u && u.plan !== 'free' ? Math.max(0, Math.round(p.price - u.credit_used)) : null,
    botsMax: p.bots, expires: u?.expires || null, phone: u?.phone || null, videoCost: VIDEO_COST,
    pending: u ? db.prepare("select plan,ref,created from payments where user_id=? and status='pending'").all(u.id) : [],
  };
}

// ---------- uchaguzi wa modeli ya bei nafuu zaidi ----------
let cache = { at: 0, map: {} };
async function prices() {
  if (Date.now() - cache.at < 3600e3 && Object.keys(cache.map).length) return cache.map;
  const j = await (await fetch('https://openrouter.ai/api/v1/models')).json();
  cache = { at: Date.now(), map: Object.fromEntries(j.data.map(m => [m.id, { p: +m.pricing?.prompt || 0, c: +m.pricing?.completion || 0, ctx: m.context_length || 0 }])) };
  return cache.map;
}
async function cheapest(tier) {
  const map = await prices();
  let list = (tier === 'pro' ? PRO : ECO).filter(id => map[id]);
  if (!list.length) list = ECO.filter(id => map[id]);
  return list.map(id => ({ id, ...map[id] })).sort((a, b) => (a.p + a.c) - (b.p + b.c)).slice(0, 3);
}

async function freeModels() {
  const map = await prices();
  if (FREE_MODELS.length) return FREE_MODELS.filter(id => map[id]).map(id => ({ id }));
  const like = /llama|gemini|qwen|deepseek|mistral|gemma/i;
  return Object.entries(map).filter(([id, m]) => id.endsWith(':free') && m.p === 0 && m.c === 0)
    .sort((a, b) => (like.test(b[0]) - like.test(a[0])) || b[1].ctx - a[1].ctx).slice(0, 3).map(([id]) => ({ id }));
}

// ---------- auth ----------
app.post('/api/register', (req, res) => {
  const { login, email, phone, name, password } = req.body || {};
  let em = null, ph = null, bad = false;
  for (const v of [login, phone, email]) {
    const x = String(v || '').trim(); if (!x) continue;
    if (x.includes('@')) em = em || x.toLowerCase(); else { const n = normPhone(x); if (n) ph = ph || n; else bad = true; }
  }
  if (bad) return res.status(400).json({ error: 'Namba ya simu si sahihi. Mfano: 0712345678' });
  if (!em && !ph) return res.status(400).json({ error: 'Weka namba ya simu au barua pepe.' });
  if (em && !/^\S+@\S+\.\S+$/.test(em)) return res.status(400).json({ error: 'Barua pepe si sahihi.' });
  if ((password || '').length < 6) return res.status(400).json({ error: 'Nenosiri liwe na angalau herufi 6.' });
  try {
    const r = db.prepare('insert into users(email,phone,name,pass,created) values(?,?,?,?,?)').run(em, ph, String(name || '').slice(0, 60), bcrypt.hashSync(password, 10), Date.now());
    res.json({ token: sign({ id: r.lastInsertRowid }) });
  } catch { res.status(409).json({ error: 'Namba ya simu au barua pepe hii tayari imesajiliwa.' }); }
});
app.post('/api/login', (req, res) => {
  const id = String(req.body?.login || req.body?.email || '').trim();
  const u = id.includes('@') ? db.prepare('select * from users where email=?').get(id.toLowerCase()) : db.prepare('select * from users where phone=?').get(normPhone(id));
  if (!u || !bcrypt.compareSync(req.body?.password || '', u.pass)) return res.status(401).json({ error: 'Simu/barua pepe au nenosiri si sahihi.' });
  res.json({ token: sign(u) });
});
app.get('/api/me', (req, res) => res.json(meInfo(req)));
app.get('/api/plans', (_req, res) => res.json({ plans: PLANS, payInfo: env.PAY_INFO || 'Wasiliana nasi kulipia.', videoCost: VIDEO_COST }));

// ---------- boti ----------
app.get('/api/bots', need, (req, res) => res.json(db.prepare('select id,name,prompt from bots where user_id=?').all(req.user.id)));
app.post('/api/bots', need, (req, res) => {
  const max = PLANS[req.user.plan].bots, n = db.prepare('select count(*) c from bots where user_id=?').get(req.user.id).c;
  if (n >= max) return res.status(403).json({ error: max ? `Mpango wako unaruhusu boti ${max} tu.` : 'Kuunda boti kunahitaji mpango wa kulipia.' });
  const name = String(req.body?.name || '').slice(0, 60).trim(), prompt = String(req.body?.prompt || '').slice(0, 2000).trim();
  if (!name || !prompt) return res.status(400).json({ error: 'Weka jina na maelekezo ya boti.' });
  const r = db.prepare('insert into bots(user_id,name,prompt) values(?,?,?)').run(req.user.id, name, prompt);
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/bots/:id', need, (req, res) => { db.prepare('delete from bots where id=? and user_id=?').run(req.params.id, req.user.id); res.json({ ok: 1 }); });

async function notify(text) {   // taarifa ya Telegram kwa mmiliki
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try { await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }) }); } catch {}
}
function activate(userId, plan, days = 30) {
  db.prepare('update users set plan=?,expires=?,credit_used=0 where id=?').run(plan, Date.now() + days * 86400e3, userId);
}

// ---------- malipo (mwongozo: thibitisha kwa mkono, unganisha Selcom/ClickPesa baadaye) ----------
app.post('/api/pay', need, (req, res) => {
  const { plan, phone, ref } = req.body || {};
  if (!PLANS[plan] || !PLANS[plan].price || !phone || !ref) return res.status(400).json({ error: 'Jaza mpango, namba ya simu na namba ya muamala.' });
  const r = String(ref).trim().slice(0, 40);
  if (db.prepare('select 1 from payments where ref=?').get(r)) return res.status(409).json({ error: 'Namba hii ya muamala imeshatumwa.' });
  db.prepare('insert into payments(user_id,plan,phone,ref,created) values(?,?,?,?,?)').run(req.user.id, plan, String(phone).slice(0, 20), r, Date.now());
  notify(`💰 Malipo mapya Mlimani AI\nMpango: ${PLANS[plan].name} (TZS ${PLANS[plan].price})\nMtumiaji: ${req.user.phone || req.user.email}\nSimu: ${phone}\nMuamala: ${r}\nThibitisha: ${env.SITE_URL || ''}/admin.html`);
  res.json({ ok: 1, message: 'Tumepokea. Mpango utawashwa baada ya kuthibitisha malipo.' });
});
const admin = (req, res, next) => env.ADMIN_KEY && req.headers['x-admin-key'] === env.ADMIN_KEY ? next() : res.status(403).json({ error: 'Hapana.' });
app.get('/api/admin/payments', admin, (_req, res) => res.json(db.prepare("select p.*,u.email,u.phone as uphone,u.name from payments p join users u on u.id=p.user_id where status='pending' order by p.id desc").all()));
app.get('/api/admin/stats', admin, (_req, res) => res.json({
  users: db.prepare('select count(*) c from users').get().c,
  paid: db.prepare("select count(*) c from users where plan!='free' and expires>?").get(Date.now()).c,
  pending: db.prepare("select count(*) c from payments where status='pending'").get().c }));
app.post('/api/admin/approve', admin, (req, res) => {
  const p = db.prepare('select * from payments where id=?').get(req.body?.id);
  if (!p) return res.status(404).json({ error: 'Haipo.' });
  activate(p.user_id, p.plan);
  db.prepare("update payments set status='approved' where id=?").run(p.id);
  res.json({ ok: 1 });
});
app.post('/api/admin/reject', admin, (req, res) => { db.prepare("update payments set status='rejected' where id=?").run(req.body?.id); res.json({ ok: 1 }); });
app.post('/api/admin/grant', admin, (req, res) => {   // washa mpango kwa mkono (simu au barua pepe)
  const id = String(req.body?.login || '').trim(), plan = req.body?.plan;
  const u = id.includes('@') ? db.prepare('select * from users where email=?').get(id.toLowerCase()) : db.prepare('select * from users where phone=?').get(normPhone(id));
  if (!u || !PLANS[plan]) return res.status(404).json({ error: 'Mtumiaji au mpango haupatikani.' });
  activate(u.id, plan, +req.body?.days || 30); res.json({ ok: 1 });
});
// Hiari: lango la malipo (Selcom/ClickPesa/AzamPay) likituma callback huwasha mpango yenyewe
app.post('/api/webhook/pay', (req, res) => {
  if (!env.WEBHOOK_SECRET || req.headers['x-webhook-secret'] !== env.WEBHOOK_SECRET) return res.status(403).json({ error: 'Hapana.' });
  const p = db.prepare("select * from payments where ref=? and status='pending'").get(String(req.body?.ref || ''));
  if (!p || +req.body?.amount < PLANS[p.plan].price) return res.status(404).json({ error: 'Muamala haulingani.' });
  activate(p.user_id, p.plan); db.prepare("update payments set status='approved' where id=?").run(p.id);
  notify(`✅ Malipo yamethibitishwa kiotomatiki: ${p.ref} (${PLANS[p.plan].name})`); res.json({ ok: 1 });
});

// ---------- picha (bure) ----------
const BAD = /(nude|naked|porn|sex|uchi|ngono|gore|mauaji)/i;
async function quick(text) {   // tafsiri maelezo ya picha kwa Kiingereza (picha hutoka vizuri zaidi)
  try {
    const ids = [...(FREE_FIRST ? (await freeModels()).slice(0, 1) : []).map(f => f.id), ...(await cheapest('eco')).slice(0, 1).map(t => t.id)];
    for (const id of ids) {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: id, max_tokens: 150, messages: [{ role: 'system', content: 'Translate the image description to English. Output only the translation.' }, { role: 'user', content: text }] }) });
      const t = (await r.json()).choices?.[0]?.message?.content?.trim(); if (t) return t;
    }
  } catch {}
  return text;
}
app.post('/api/image', async (req, res) => {
  const raw = String(req.body?.prompt || '').trim().slice(0, 400);
  if (raw.length < 3) return res.status(400).json({ error: 'Eleza picha unayotaka.' });
  if (BAD.test(raw)) return res.status(400).json({ error: 'Maelezo haya hayaruhusiwi.' });
  const k = 'img:' + keyFor(req);
  if (used(k) >= IMG_LIM(req.user)) return res.status(429).json({ error: req.user ? 'Picha za leo zimeisha. Rudi kesho.' : 'Picha ya bure ya leo imeisha. Fungua akaunti kupata zaidi.', me: meInfo(req) });
  bump(k);
  try {
    const en = OR_KEY ? await quick(raw) : raw;
    const q = `width=768&height=768&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
    const r = PK ? await fetch(`https://gen.pollinations.ai/image/${encodeURIComponent(en)}?model=flux&${q}`, { headers: { Authorization: `Bearer ${PK}` }, signal: AbortSignal.timeout(70000) })
                 : await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(en)}?${q}`, { signal: AbortSignal.timeout(70000) });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.startsWith('image/')) throw new Error('picha imeshindwa ' + r.status);
    res.json({ image: `data:${ct};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`, me: meInfo(req) });
  } catch (e) { bump(k, -1); console.error('image error:', e.message); res.status(502).json({ error: 'Samahani, huduma ya picha ina shida kwa sasa. Jaribu tena baadaye.' }); }
});

// ---------- video (kulipia, inakata mkopo) ----------
const jobs = new Map();
setInterval(() => { for (const [k, j] of jobs) if (Date.now() - j.t > 15 * 60e3) jobs.delete(k); }, 60e3);
app.post('/api/video', need, (req, res) => {
  const u = req.user, plan = PLANS[u.plan];
  if (u.plan === 'free') return res.status(403).json({ error: 'Video inapatikana kwa mipango ya kulipia.' });
  if (!PK) return res.status(500).json({ error: 'Huduma ya video haijawekwa bado.' });
  const raw = String(req.body?.prompt || '').trim().slice(0, 400);
  if (raw.length < 3) return res.status(400).json({ error: 'Eleza video unayotaka.' });
  if (BAD.test(raw)) return res.status(400).json({ error: 'Maelezo haya hayaruhusiwi.' });
  if (u.credit_used + VIDEO_COST > plan.price) return res.status(402).json({ error: 'Mkopo wako hautoshi kwa video.' });
  if ([...jobs.values()].some(j => j.uid === u.id && j.status === 'working')) return res.status(429).json({ error: 'Subiri video ya kwanza imalizike.' });
  const k = 'vid:u' + u.id;
  if (used(k) >= VIDEO_DAILY) return res.status(429).json({ error: 'Video za leo zimeisha. Rudi kesho.' });
  bump(k);
  const id = randomUUID(), job = { uid: u.id, status: 'working', t: Date.now() }; jobs.set(id, job);
  (async () => {
    try {
      const en = await quick(raw);
      const r = await fetch(`https://gen.pollinations.ai/image/${encodeURIComponent(en)}?model=${env.VIDEO_MODEL || 'seedance'}&duration=5&nologo=true`, { headers: { Authorization: `Bearer ${PK}` }, signal: AbortSignal.timeout(240000) });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.startsWith('video/')) throw new Error('video imeshindwa ' + r.status);
      job.buf = Buffer.from(await r.arrayBuffer()); job.ct = ct;
      if (job.buf.length > 30e6) throw new Error('video kubwa mno');
      db.prepare('update users set credit_used=credit_used+? where id=?').run(VIDEO_COST, u.id);
      job.status = 'done';
    } catch (e) { job.status = 'error'; bump(k, -1); console.error('video error:', e.message); }
  })();
  res.json({ id });
});
app.get('/api/video/:id', need, (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.uid !== req.user.id) return res.status(404).json({ error: 'Haipo.' });
  res.json({ status: j.status });
});
app.get('/api/video/:id/file', need, (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.uid !== req.user.id || j.status !== 'done') return res.status(404).end();
  res.set('Content-Type', j.ct).send(j.buf);
});

// ---------- gumzo ----------
app.post('/api/chat', async (req, res) => {
  if (!OR_KEY) return res.status(500).json({ error: 'Huduma haijawekwa bado.' });
  const msgs = (req.body?.messages || []).slice(-12)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })).filter(m => m.content);
  if (!msgs.length || msgs.at(-1).role !== 'user') return res.status(400).json({ error: 'Andika ujumbe.' });

  const u = req.user, plan = PLANS[u ? u.plan : 'free'], k = keyFor(req), lim = limitFor(u);
  if (ASK.test(msgs.at(-1).content)) return res.json({ reply: REFUSAL, me: meInfo(req) }); // haitumii token, haihesabiwi
  if (lim !== null && used(k) >= lim) return res.status(429).json({ error: u ? 'Umetumia ujumbe wako wa bure wa leo. Rudi kesho au chagua mpango wa kulipia.' : 'Ujumbe wa bure wa leo umeisha. Fungua akaunti kupata zaidi, au rudi kesho.', limit: true, me: meInfo(req) });
  if (u && u.plan !== 'free' && u.credit_used >= plan.price) return res.status(402).json({ error: 'Mkopo wako wa mwezi umeisha. Pandisha mpango au subiri mwezi ujao.', me: meInfo(req) });

  let system = BASE + ((u && u.plan !== 'free') ? '\nToa majibu kamili yenye maelezo ya kutosha.' : '\nJibu kwa ufupi, sentensi chache.');
  if (u && req.body.botId) {
    const b = db.prepare('select * from bots where id=? and user_id=?').get(req.body.botId, u.id);
    if (b) system += `\n\nJina lako kwa mtumiaji ni "${b.name}". Maelekezo ya mmiliki wa boti:\n${b.prompt}`;
  }
  if (lim !== null) bump(k);
  try {
    const paid = await cheapest(plan.tier);
    const free = FREE_FIRST ? (await freeModels()).slice(0, 2) : [];
    const steps = [...free.map(f => ({ ids: [f.id], p: 0, c: 0, ms: 25000, free: true })),
      ...(paid.length ? [{ ids: paid.map(t => t.id), p: paid[0].p, c: paid[0].c, ms: 60000, free: false }] : [])];
    if (!steps.length) throw new Error('hakuna modeli');
    let d, step;
    for (const s of steps) {           // bure kwanza, kisha ya kulipia ikiwa za bure zimejaa au zimeshindwa
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST', signal: AbortSignal.timeout(s.ms),
          headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': env.SITE_URL || 'https://mlimani.net', 'X-Title': 'Mlimani' },
          body: JSON.stringify({ model: s.ids[0], ...(s.ids.length > 1 ? { models: s.ids } : {}), max_tokens: plan.maxTokens, usage: { include: true },
            messages: [{ role: 'system', content: system }, ...msgs] }),
        });
        const j = await r.json();
        if (r.ok && j.choices?.[0]?.message?.content) { d = j; step = s; break; }
        console.error('hatua imeshindwa:', s.ids[0], j.error?.message);
      } catch (e) { console.error('hatua imeshindwa:', s.ids[0], e.message); }
    }
    if (!d) throw new Error('modeli zote zimeshindwa');
    console.log(step.free ? 'IMETUMIA BURE' : 'IMETUMIA KULIPIA');
    const usd = step.free ? 0 : (d.usage?.cost ?? ((d.usage?.prompt_tokens || 0) * step.p + (d.usage?.completion_tokens || 0) * step.c));
    if (u && u.plan !== 'free') db.prepare('update users set credit_used=credit_used+? where id=?').run(usd * MARKUP * USD_TZS, u.id);
    if (u) req.user = db.prepare('select * from users where id=?').get(u.id);
    res.json({ reply: d.choices[0].message.content, me: meInfo(req) }); // jina la modeli halitumwi kwa mtumiaji
  } catch (e) {
    if (lim !== null) bump(k, -1);
    console.error('chat error:', e.message);
    res.status(502).json({ error: 'Samahani, huduma ina shida kwa sasa. Jaribu tena baadaye.' });
  }
});

app.listen(env.PORT || 3000, () => console.log('Mlimani AI iko hewani'));
