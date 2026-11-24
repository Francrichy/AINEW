import express from 'express';
import { randomUUID } from 'crypto';

const DEFAULT_PRICING = [
  ['chat', 'Chat', 'chat', 'per_1000_tokens', 0, 0, 'TZS', 'Gharama na bei bado hazijathibitishwa'],
  ['video', 'Video', 'video', 'per_video_5s', 0, 0, 'TZS', 'Gharama na bei bado hazijathibitishwa'],
  ['live_talk', 'Live Talk', 'live_talk', 'per_minute', 0, 0, 'TZS', 'Gharama na bei bado hazijathibitishwa'],
  ['advertisement_15', 'Advertisement 15s', 'advertisement', 'per_ad', 0, 150, 'credits', 'Bei ya majaribio; si bei rasmi'],
  ['advertisement_30', 'Advertisement 30s', 'advertisement', 'per_ad', 0, 250, 'credits', 'Bei ya majaribio; si bei rasmi'],
  ['image', 'Image', 'image', 'per_image', 0, 0, 'TZS', 'Gharama na bei bado hazijathibitishwa']
];

const DEFAULT_PLANS = [
  ['free', 'Bure', 0, 0, 30, 0, 0, 0, 0, 0, 'active'],
  ['kawaida', 'Kawaida', 10000, 10000, 30, 1, 10000, 0, 0, 0, 'active'],
  ['biashara', 'Biashara', 30000, 30000, 30, 10, 30000, 0, 0, 0, 'active'],
  ['kampuni', 'Kampuni', 100000, 100000, 30, 50, 100000, 0, 0, 0, 'active']
];

export function initializeBilling(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_balances (
      user_id INTEGER NOT NULL,
      service TEXT NOT NULL,
      bucket TEXT NOT NULL CHECK(bucket IN ('subscription','purchased')),
      balance REAL NOT NULL DEFAULT 0 CHECK(balance >= 0),
      expires_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, service, bucket)
    );
    CREATE TABLE IF NOT EXISTS credits_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      service TEXT NOT NULL,
      bucket TEXT NOT NULL CHECK(bucket IN ('subscription','purchased')),
      entry_type TEXT NOT NULL,
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      reference TEXT UNIQUE,
      description TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS credits_ledger_user_created ON credits_ledger(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS subscription_plans (
      plan_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      monthly_price_tzs REAL NOT NULL DEFAULT 0,
      monthly_credits REAL NOT NULL DEFAULT 0,
      duration_days INTEGER NOT NULL DEFAULT 30,
      bots INTEGER NOT NULL DEFAULT 0,
      chat_credits REAL NOT NULL DEFAULT 0,
      video_credits REAL NOT NULL DEFAULT 0,
      live_talk_credits REAL NOT NULL DEFAULT 0,
      advertisement_credits REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      renews_at INTEGER,
      auto_renew INTEGER NOT NULL DEFAULT 0,
      payment_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_subscriptions_user ON user_subscriptions(user_id, ends_at DESC);
    CREATE TABLE IF NOT EXISTS admin_pricing (
      config_key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      service TEXT NOT NULL,
      unit TEXT NOT NULL,
      provider_cost REAL NOT NULL DEFAULT 0,
      customer_price REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'TZS',
      notes TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `);

  const now = Date.now();
  const planInsert = db.prepare(`INSERT OR IGNORE INTO subscription_plans
    (plan_key,name,monthly_price_tzs,monthly_credits,duration_days,bots,chat_credits,video_credits,live_talk_credits,advertisement_credits,status,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const p of DEFAULT_PLANS) planInsert.run(...p, now);

  const priceInsert = db.prepare(`INSERT OR IGNORE INTO admin_pricing
    (config_key,label,service,unit,provider_cost,customer_price,currency,notes,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const p of DEFAULT_PRICING) priceInsert.run(...p, now);

  db.prepare(`INSERT OR IGNORE INTO admin_pricing
    (config_key,label,service,unit,provider_cost,customer_price,currency,notes,updated_at)
    VALUES ('markup_multiplier','Markup multiplier','all','multiplier',4,4,'x','Lengo la sasa: gharama halisi mara 4; thamani inaweza kubadilishwa na Admin.',?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO admin_pricing
    (config_key,label,service,unit,provider_cost,customer_price,currency,notes,updated_at)
    VALUES ('usd_tzs','USD/TZS exchange rate','all','exchange_rate',2600,2600,'TZS','Weka kiwango cha ubadilishaji kinachotumika.',?)`).run(now);
}

export function syncBillingPlans(db, plans) {\n  const rows = db.prepare('SELECT plan_key,name,monthly_price_tzs,bots FROM subscription_plans').all();\n  for (const row of rows) if (plans[row.plan_key]) Object.assign(plans[row.plan_key], { name: row.name, price: row.monthly_price_tzs, bots: row.bots });\n}\n\nexport function registerBillingRoutes(app, { db, need, admin, plans: runtimePlans }) {
  const router = express.Router();
  router.get('/wallet', need, (req, res) => {
    const balances = db.prepare('SELECT service,bucket,balance,expires_at,updated_at FROM wallet_balances WHERE user_id=? ORDER BY service,bucket').all(req.user.id);
    res.json({ balances });
  });
  router.get('/wallet/ledger', need, (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const rows = db.prepare('SELECT id,service,bucket,entry_type,amount,balance_after,reference,description,created_at FROM credits_ledger WHERE user_id=? ORDER BY id DESC LIMIT ?').all(req.user.id, limit);
    res.json({ entries: rows });
  });
  router.get('/subscription', need, (req, res) => {
    const subscription = db.prepare('SELECT s.*,p.name,p.monthly_price_tzs FROM user_subscriptions s LEFT JOIN subscription_plans p ON p.plan_key=s.plan_key WHERE s.user_id=? ORDER BY s.id DESC LIMIT 1').get(req.user.id) || null;
    res.json({ subscription });
  });

  router.get('/admin/billing/overview', admin, (_req, res) => {
    const totals = {
      users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      activeSubscriptions: db.prepare("SELECT COUNT(*) AS n FROM user_subscriptions WHERE status='active' AND ends_at>?").get(Date.now()).n,
      walletRows: db.prepare('SELECT COUNT(*) AS n FROM wallet_balances').get().n,
      ledgerEntries: db.prepare('SELECT COUNT(*) AS n FROM credits_ledger').get().n
    };
    res.json({ totals });
  });
  router.get('/admin/billing/pricing', admin, (_req, res) => {
    res.json({ pricing: db.prepare('SELECT * FROM admin_pricing ORDER BY service,config_key').all() });
  });
  router.post('/admin/billing/pricing', admin, (req, res) => {
    const b = req.body || {};
    const key = String(b.config_key || '').trim();
    if (!/^[a-z0-9_]{2,80}$/.test(key)) return res.status(400).json({ error: 'Kitambulisho cha bei si sahihi.' });
    const existing = db.prepare('SELECT * FROM admin_pricing WHERE config_key=?').get(key);
    if (!existing) return res.status(404).json({ error: 'Mpangilio wa bei haupo. Ongeza aina mpya kupitia usimamizi wa mfumo.' });
    const providerCost = Number(b.provider_cost), customerPrice = Number(b.customer_price);
    if (!Number.isFinite(providerCost) || providerCost < 0 || !Number.isFinite(customerPrice) || customerPrice < 0) return res.status(400).json({ error: 'Gharama na bei lazima ziwe namba zisizo hasi.' });
    const notes = String(b.notes ?? existing.notes).slice(0,500);
    db.prepare('UPDATE admin_pricing SET provider_cost=?,customer_price=?,notes=?,updated_at=? WHERE config_key=?').run(providerCost, customerPrice, notes, Date.now(), key);
    res.json({ ok: true, pricing: db.prepare('SELECT * FROM admin_pricing WHERE config_key=?').get(key) });
  });
  router.get('/admin/billing/subscriptions', admin, (req, res) => {\n    const limit=Math.min(200,Math.max(1,Number(req.query.limit)||50));\n    res.json({subscriptions:db.prepare('SELECT s.*,u.email,u.phone,u.name,p.name AS plan_name FROM user_subscriptions s JOIN users u ON u.id=s.user_id LEFT JOIN subscription_plans p ON p.plan_key=s.plan_key ORDER BY s.id DESC LIMIT ?').all(limit)});\n  });\n  router.get('/admin/billing/plans', admin, (_req, res) => {
    res.json({ plans: db.prepare('SELECT * FROM subscription_plans ORDER BY monthly_price_tzs').all() });
  });
  router.post('/admin/billing/plans', admin, (req, res) => {
    const b = req.body || {}, key = String(b.plan_key || '').trim();
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) return res.status(400).json({ error: 'Plan key si sahihi.' });
    const name = String(b.name || '').trim().slice(0,80);
    const vals = ['monthly_price_tzs','monthly_credits','duration_days','bots','chat_credits','video_credits','live_talk_credits','advertisement_credits'].map(k => Number(b[k]));
    if (!name || vals.some((v,i) => !Number.isFinite(v) || v < 0) || !Number.isInteger(vals[2]) || vals[2] < 1) return res.status(400).json({ error: 'Jina, bei na credits lazima ziwe sahihi; muda uwe siku kamili.' });
    db.prepare(`INSERT INTO subscription_plans
      (plan_key,name,monthly_price_tzs,monthly_credits,duration_days,bots,chat_credits,video_credits,live_talk_credits,advertisement_credits,status,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(plan_key) DO UPDATE SET name=excluded.name,monthly_price_tzs=excluded.monthly_price_tzs,monthly_credits=excluded.monthly_credits,duration_days=excluded.duration_days,bots=excluded.bots,chat_credits=excluded.chat_credits,video_credits=excluded.video_credits,live_talk_credits=excluded.live_talk_credits,advertisement_credits=excluded.advertisement_credits,status=excluded.status,updated_at=excluded.updated_at`)
      .run(key,name,...vals,String(b.status||'active')==='inactive'?'inactive':'active',Date.now());
    if (runtimePlans?.[key]) Object.assign(runtimePlans[key], { name, price: vals[0], bots: vals[3] });\n    res.json({ ok:true, plan:db.prepare('SELECT * FROM subscription_plans WHERE plan_key=?').get(key) });
  });
  router.post('/admin/billing/adjust', admin, (req, res) => {
    const b=req.body||{}, userId=Number(b.user_id), service=String(b.service||'').trim(), bucket=b.bucket==='purchased'?'purchased':'subscription', amount=Number(b.amount);
    if(!Number.isInteger(userId)||userId<1||!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId)) return res.status(400).json({error:'Mtumiaji hajapatikana.'});
    if(!/^[a-z][a-z0-9_]{1,40}$/.test(service)||!Number.isFinite(amount)||amount===0) return res.status(400).json({error:'Huduma au kiasi si sahihi.'});
    const reference='admin:'+randomUUID();
    const tx=db.transaction(()=>{
      const row=db.prepare('SELECT balance FROM wallet_balances WHERE user_id=? AND service=? AND bucket=?').get(userId,service,bucket);
      const before=row?.balance||0, after=before+amount;
      if(after<0) throw new Error('Salio haliwezi kuwa chini ya sifuri.');
      db.prepare(`INSERT INTO wallet_balances(user_id,service,bucket,balance,expires_at,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(user_id,service,bucket) DO UPDATE SET balance=excluded.balance,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
        .run(userId,service,bucket,after,bucket==='subscription'?(Number(b.expires_at)||null):null,Date.now());
      db.prepare('INSERT INTO credits_ledger(user_id,service,bucket,entry_type,amount,balance_after,reference,description,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(userId,service,bucket,amount>0?'admin_credit':'admin_debit',amount,after,reference,String(b.description||'Marekebisho ya Admin').slice(0,300),Date.now());
      return after;
    });
    try { const balance=tx(); res.json({ok:true,balance,reference}); } catch(e) { res.status(400).json({error:e.message}); }
  });
  app.use('/api', router);
}
