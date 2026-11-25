import { randomUUID } from 'node:crypto';
import { registerStudioProviderRoutes } from './studio-provider-adapters.js';

const json = (res, status, body) => res.status(status).json(body);
const priceForMinute = db => Number(db.prepare("SELECT customer_price FROM admin_pricing WHERE config_key='studio_film_minute_tzs'").get()?.customer_price || 0);

function workerConfig(env) {
  const base = String(env.MLIMANI_FILM_WORKER_URL || '').replace(/\/+$/, '');
  const token = String(env.MLIMANI_INTERNAL_TOKEN || '');
  return base && token ? { base, token } : null;
}

async function workerFetch(config, path, options = {}) {
  const response = await fetch(config.base + path, {
    ...options,
    signal: options.signal || AbortSignal.timeout(30000),
    headers: { Authorization: 'Bearer ' + config.token, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Huduma ya Film Worker haipatikani.'), { status: response.status });
  return data;
}

export function registerFilmJobRoutes(app, { db, need, env, cashWalletBalance, consumeWalletCredits, creditCashWallet }) {
  registerStudioProviderRoutes(app, { db, need, env, cashWalletBalance, consumeWalletCredits, creditCashWallet });
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_film_jobs (
      id TEXT PRIMARY KEY,
      worker_job_id TEXT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      total_duration_seconds INTEGER NOT NULL,
      scene_count INTEGER NOT NULL,
      charge_tzs REAL NOT NULL DEFAULT 0,
      billing_status TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'submitting',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS studio_film_jobs_user_created ON studio_film_jobs(user_id, created_at DESC);
  `);

  app.get('/api/studio/film/estimate', need, (req, res) => {
    const totalSeconds = Math.round(Number(req.query.durationSeconds));
    if (!Number.isInteger(totalSeconds) || totalSeconds < 60 || totalSeconds > 1800) {
      return json(res, 400, { error: 'Muda wa filamu uwe kati ya dakika 1 na 30.' });
    }
    const minuteRateTzs = priceForMinute(db);
    const billedMinutes = Math.ceil(totalSeconds / 60);
    const estimatedChargeTzs = billedMinutes * minuteRateTzs;
    const walletBalanceTzs = cashWalletBalance(db, req.user.id);
    const config = workerConfig(env);
    return res.json({
      enabled: Boolean(config && minuteRateTzs > 0 && walletBalanceTzs >= estimatedChargeTzs),
      workerConfigured: Boolean(config),
      priceConfigured: minuteRateTzs > 0,
      totalSeconds, billedMinutes, customerPricePerMinuteTzs: minuteRateTzs,
      estimatedChargeTzs, walletBalanceTzs, maxScenes: 120,
      note: !config ? 'Cloudflare Film Worker bado haijaunganishwa.' : minuteRateTzs <= 0 ? 'Bei ya filamu bado haijaidhinishwa na Admin.' : ''
    });
  });

  app.post('/api/studio/film/jobs', need, async (req, res) => {
    const config = workerConfig(env);
    if (!config) return json(res, 503, { error: 'Film Studio bado haijaunganishwa na Cloudflare. Hakuna malipo yaliyofanyika.' });
    const title = String(req.body?.title || 'Mlimani Film').trim().slice(0, 120);
    const language = ['sw', 'en', 'sw-en'].includes(String(req.body?.language || 'sw')) ? String(req.body?.language || 'sw') : 'sw';
    const scenes = req.body?.scenes;
    if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 120) {
      return json(res, 400, { error: 'Filamu inahitaji scenes 1 hadi 120.' });
    }
    const normalized = [];
    let totalSeconds = 0;
    for (let i = 0; i < scenes.length; i++) {
      const prompt = String(scenes[i]?.prompt || '').trim();
      const duration = Number(scenes[i]?.duration || 15);
      const aspectRatio = ['9:16', '16:9', '1:1'].includes(scenes[i]?.aspectRatio) ? scenes[i].aspectRatio : '16:9';
      if (prompt.length < 3 || prompt.length > 1600 || ![5, 15].includes(duration)) {
        return json(res, 400, { error: 'Scene ' + (i + 1) + ' ina maelezo au muda usioruhusiwa.' });
      }
      normalized.push({ prompt, duration, aspectRatio });
      totalSeconds += duration;
    }
    if (totalSeconds < 60 || totalSeconds > 1800) return json(res, 400, { error: 'Jumla ya muda wa scenes iwe kati ya dakika 1 na 30.' });
    const minuteRateTzs = priceForMinute(db);
    if (!Number.isFinite(minuteRateTzs) || minuteRateTzs <= 0) {
      return json(res, 503, { error: 'Bei ya filamu bado haijaidhinishwa na Admin. Hakuna salio lililokatwa.' });
    }
    const billedMinutes = Math.ceil(totalSeconds / 60);
    const chargeTzs = billedMinutes * minuteRateTzs;
    if (cashWalletBalance(db, req.user.id) < chargeTzs) {
      return json(res, 402, { error: 'Salio la Wallet halitoshi. Unahitaji TZS ' + chargeTzs.toLocaleString('en-US') + ' kwa filamu hii.' });
    }

    const id = randomUUID();
    const now = Date.now();
    db.prepare(`INSERT INTO studio_film_jobs
      (id,user_id,title,total_duration_seconds,scene_count,charge_tzs,billing_status,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'pending','submitting',?,?)`)
      .run(id, req.user.id, title, totalSeconds, normalized.length, chargeTzs, now, now);

    try {
      consumeWalletCredits(db, req.user.id, 'cash', chargeTzs, 'Mlimani Studio Film reservation ' + id);
      db.prepare("UPDATE studio_film_jobs SET billing_status='charged',updated_at=? WHERE id=?").run(Date.now(), id);
      const created = await workerFetch(config, '/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: String(req.user.id), title, language, scenes: normalized })
      });
      if (!created.jobId) throw new Error('Cloudflare haikurudisha namba ya kazi.');
      db.prepare("UPDATE studio_film_jobs SET worker_job_id=?,status=?,updated_at=? WHERE id=?")
        .run(created.jobId, created.status || 'queued', Date.now(), id);
      return res.status(202).json({
        jobId: id, status: created.status || 'queued', totalScenes: normalized.length,
        totalDurationSeconds: totalSeconds, chargedTzs: chargeTzs,
        walletBalanceTzs: cashWalletBalance(db, req.user.id)
      });
    } catch (error) {
      try {
        creditCashWallet(db, req.user.id, chargeTzs, 'studio-film-refund:' + id, 'Refund ya filamu iliyoshindwa kuanzishwa');
        db.prepare("UPDATE studio_film_jobs SET billing_status='refunded',status='failed_to_start',updated_at=? WHERE id=?").run(Date.now(), id);
      } catch (refundError) {
        console.error('Studio film refund FAILED:', id, refundError.message);
        db.prepare("UPDATE studio_film_jobs SET status='refund_review',updated_at=? WHERE id=?").run(Date.now(), id);
      }
      console.error('Studio film submit:', error.message);
      return json(res, 502, { error: 'Imeshindikana kuanzisha filamu. Ikiwa salio lilikatwa, mfumo umejaribu kulirudisha; wasiliana na Admin ikiwa halijaonekana.' });
    }
  });

  app.get('/api/studio/film/jobs/:id', need, async (req, res) => {
    const job = db.prepare('SELECT * FROM studio_film_jobs WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!job) return json(res, 404, { error: 'Kazi haipatikani.' });
    if (!job.worker_job_id) return res.json({ jobId: job.id, status: job.status, billingStatus: job.billing_status });
    try {
      const config = workerConfig(env);
      if (!config) return json(res, 503, { error: 'Muunganisho wa Film Worker haupo.' });
      const manifest = await workerFetch(config, '/jobs/' + encodeURIComponent(job.worker_job_id) + '?ownerId=' + encodeURIComponent(String(req.user.id)));
      const status = String(manifest.status || 'working');
      if (status === 'completed' && job.status !== 'completed') {
        db.prepare("UPDATE studio_film_jobs SET status='completed',updated_at=? WHERE id=?").run(Date.now(), job.id);
      } else if (['failed', 'failed_to_start', 'cancelled'].includes(status) && job.billing_status === 'charged') {
        try {
          creditCashWallet(db, req.user.id, Number(job.charge_tzs), 'studio-film-refund:' + job.id, 'Refund ya filamu iliyoshindwa ' + job.id);
          db.prepare("UPDATE studio_film_jobs SET billing_status='refunded',status='failed',updated_at=? WHERE id=?").run(Date.now(), job.id);
        } catch (error) {
          console.error('Studio film refund FAILED:', job.id, error.message);
          db.prepare("UPDATE studio_film_jobs SET status='refund_review',updated_at=? WHERE id=?").run(Date.now(), job.id);
        }
      } else if (job.status !== status && job.status !== 'completed') {
        db.prepare('UPDATE studio_film_jobs SET status=?,updated_at=? WHERE id=?').run(status, Date.now(), job.id);
      }
      return res.json({
        jobId: job.id, status: manifest.status, progressPercent: manifest.progressPercent || 0,
        totalScenes: manifest.totalScenes || job.scene_count,
        completedScenes: manifest.completedScenes || 0,
        title: manifest.title || job.title, error: manifest.error || null,
        output: manifest.status === 'completed' ? manifest.output : null,
        billingStatus: ['failed', 'failed_to_start', 'cancelled'].includes(status) ? 'refunded' : job.billing_status
      });
    } catch (error) {
      return json(res, error.status || 502, { error: 'Imeshindikana kupata maendeleo ya filamu kwa sasa.' });
    }
  });

  app.get('/api/studio/film/jobs/:id/download', need, async (req, res) => {
    const job = db.prepare("SELECT * FROM studio_film_jobs WHERE id=? AND user_id=? AND status='completed'").get(req.params.id, req.user.id);
    if (!job?.worker_job_id) return json(res, 404, { error: 'Filamu bado haijakamilika.' });
    try {
      const config = workerConfig(env);
      const result = await workerFetch(config, '/jobs/' + encodeURIComponent(job.worker_job_id) + '/download?ownerId=' + encodeURIComponent(String(req.user.id)));
      return res.json({ url: result.url, expiresIn: result.expiresIn || 600 });
    } catch (error) {
      return json(res, error.status || 502, { error: 'Imeshindikana kuandaa kiungo cha kupakua filamu.' });
    }
  });
}
