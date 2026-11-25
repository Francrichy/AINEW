import { randomUUID } from 'node:crypto';

const DEFAULT_REPLICATE_ANIMATION_MODEL = 'minimax/video-01-live';
const DEFAULT_REPLICATE_ANIMATION_TEMPLATE = JSON.stringify({ prompt: '{{prompt}}', first_frame_image: '{{imageUrl}}', prompt_optimizer: true });

export function buildReplicateInput(templateText, variables) {
  if (typeof templateText !== 'string' || templateText.length < 2 || templateText.length > 12000) {
    throw new Error('REPLICATE_ANIMATION_INPUT_TEMPLATE haijawekwa vizuri.');
  }
  const template = JSON.parse(templateText);
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    throw new Error('Replicate input template lazima iwe JSON object.');
  }
  if (!JSON.stringify(template).includes('{{prompt}}')) {
    throw new Error('Replicate input template lazima iwe na {{prompt}} placeholder.');
  }
  const apply = value => {
    if (Array.isArray(value)) return value.map(apply);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, apply(item)]));
    if (typeof value !== 'string') return value;
    const exact = value.match(/^\{\{(prompt|imageUrl|durationSeconds|aspectRatio)\}\}$/);
    if (exact) return variables[exact[1]] ?? '';
    return value.replace(/\{\{(prompt|imageUrl|durationSeconds|aspectRatio)\}\}/g, (_match, key) => String(variables[key] ?? ''));
  };
  return apply(template);
}

const parseBody = async response => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.message || body.error || body.error_message || body.detail || 'HTTP ' + response.status;
    throw Object.assign(new Error(String(detail).slice(0, 500)), { status: response.status });
  }
  return body;
};

const voiceSeconds = script => Math.max(5, Math.min(600, Math.ceil(String(script || '').trim().split(/\s+/).filter(Boolean).length / 2.5)));

export function registerStudioAsyncProviderRoutes(app, { db, need, env, cashWalletBalance, consumeWalletCredits, creditCashWallet }) {
  const now = () => Date.now();
  const getPrice = key => Number(db.prepare('SELECT customer_price FROM admin_pricing WHERE config_key=?').get(key)?.customer_price || 0);
  const ensurePrice = (key, label, service, unit, notes) => db.prepare(`INSERT OR IGNORE INTO admin_pricing
    (config_key,label,service,unit,provider_cost,customer_price,currency,notes,updated_at)
    VALUES(?,?,?,?,0,0,'TZS',?,?)`).run(key, label, service, unit, notes, now());
  ensurePrice('studio_motion_second_tzs', 'Mlimani Motion Studio kwa sekunde', 'studio_motion', 'per_second', 'Bei ya mteja kwa sekunde; weka baada ya kuthibitisha gharama za Runway/Luma.');
  ensurePrice('studio_avatar_video_second_tzs', 'Mlimani Avatar Video kwa sekunde', 'studio_avatar_video', 'per_second', 'Bei ya mteja kwa sekunde; weka baada ya kuthibitisha gharama za HeyGen.');
  ensurePrice('studio_animation_tzs', 'Mlimani Animation Studio kwa kazi', 'studio_animation', 'per_animation', 'Bei ya mteja kwa animation moja; default model minimax/video-01-live ina gharama ya provider kwa kila video.');

  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_async_jobs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      job_type TEXT NOT NULL,
      provider_job_id TEXT,
      prompt TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      charge_tzs REAL NOT NULL DEFAULT 0,
      billing_status TEXT NOT NULL DEFAULT 'reserved',
      status TEXT NOT NULL DEFAULT 'submitting',
      output_url TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS studio_async_jobs_user_created ON studio_async_jobs(user_id, created_at DESC);
  `);

  const reserve = (userId, amount, label) => {
    if (!(amount > 0)) throw Object.assign(new Error('Bei ya huduma haijaidhinishwa na Admin.'), { status: 503 });
    if (cashWalletBalance(db, userId) < amount) throw Object.assign(new Error('Salio la Wallet halitoshi. Unahitaji TZS ' + amount.toLocaleString('en-US') + '.'), { status: 402 });
    consumeWalletCredits(db, userId, 'cash', amount, label);
  };
  const refund = (job, reason) => {
    creditCashWallet(db, job.user_id, Number(job.charge_tzs), 'studio-async-refund:' + job.id, reason);
    db.prepare("UPDATE studio_async_jobs SET billing_status='refunded',status='failed',error=?,updated_at=? WHERE id=?")
      .run(String(reason).slice(0, 500), now(), job.id);
  };
  const jsonError = (res, error, fallback = 'Huduma haikufanya kazi kwa sasa.') =>
    res.status(error.status || 502).json({ error: (error.message || fallback).slice(0, 500) });

  async function createRunway(prompt, duration, ratio, userId) {
    const response = await fetch('https://api.dev.runwayml.com/v1/text_to_video', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RUNWAY_API_KEY,
        'X-Runway-Version': '2024-11-06',
        'X-Runway-Tags': 'product:mlimani,service:motion',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: env.RUNWAY_MODEL || 'seedance2_5', promptText: prompt, ratio, duration }),
      signal: AbortSignal.timeout(60000)
    });
    return parseBody(response);
  }

  async function getRunway(taskId) {
    const response = await fetch('https://api.dev.runwayml.com/v1/tasks/' + encodeURIComponent(taskId), {
      headers: { Authorization: 'Bearer ' + env.RUNWAY_API_KEY, 'X-Runway-Version': '2024-11-06' },
      signal: AbortSignal.timeout(30000)
    });
    return parseBody(response);
  }

  async function createLuma(prompt, duration, ratio, userId) {
    const response = await fetch('https://agents.lumalabs.ai/v1/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.LUMA_AGENTS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt, model: env.LUMA_VIDEO_MODEL || 'ray-3.2', type: 'video', aspect_ratio: ratio,
        video: { duration: duration + 's', resolution: env.LUMA_VIDEO_RESOLUTION || '720p' },
        user_id: String(userId)
      }),
      signal: AbortSignal.timeout(60000)
    });
    return parseBody(response);
  }

  async function getLuma(generationId) {
    const response = await fetch('https://agents.lumalabs.ai/v1/generations/' + encodeURIComponent(generationId), {
      headers: { Authorization: 'Bearer ' + env.LUMA_AGENTS_API_KEY },
      signal: AbortSignal.timeout(30000)
    });
    return parseBody(response);
  }

  async function createHeyGen(input) {
    const response = await fetch('https://api.heygen.com/v3/videos', {
      method: 'POST',
      headers: { 'X-Api-Key': env.HEYGEN_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(60000)
    });
    return parseBody(response);
  }

  async function createReplicate(input) {
    const model = String(env.REPLICATE_ANIMATION_MODEL || DEFAULT_REPLICATE_ANIMATION_MODEL).trim();
    const version = String(env.REPLICATE_ANIMATION_VERSION || '').trim();
    const useVersion = Boolean(version && !env.REPLICATE_ANIMATION_MODEL);
    const endpoint = useVersion ? 'https://api.replicate.com/v1/predictions' : 'https://api.replicate.com/v1/models/' + model + '/predictions';
    const body = useVersion ? { version, input } : { input };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.REPLICATE_API_TOKEN, 'Content-Type': 'application/json', Prefer: 'wait=1', 'Cancel-After': '10m' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000)
    });
    return parseBody(response);
  }

  async function getReplicate(predictionId) {
    const response = await fetch('https://api.replicate.com/v1/predictions/' + encodeURIComponent(predictionId), {
      headers: { Authorization: 'Bearer ' + env.REPLICATE_API_TOKEN },
      signal: AbortSignal.timeout(30000)
    });
    return parseBody(response);
  }

  async function getHeyGen(videoId) {
    const response = await fetch('https://api.heygen.com/v3/videos/' + encodeURIComponent(videoId), {
      headers: { 'X-Api-Key': env.HEYGEN_API_KEY },
      signal: AbortSignal.timeout(30000)
    });
    return parseBody(response);
  }

  function providerKey(provider) {
    return provider === 'runway' ? env.RUNWAY_API_KEY : provider === 'luma' ? env.LUMA_AGENTS_API_KEY : provider === 'heygen' ? env.HEYGEN_API_KEY : provider === 'replicate' ? env.REPLICATE_API_TOKEN : null;
  }

  function normalizeJob(provider, data) {
    if (provider === 'runway') {
      const status = String(data.status || 'PENDING').toLowerCase();
      const output = Array.isArray(data.output) ? data.output[0] : data.output;
      return {
        status: ['succeeded', 'completed'].includes(status) ? 'completed' : ['failed', 'canceled', 'cancelled'].includes(status) ? 'failed' : 'processing',
        outputUrl: typeof output === 'string' ? output : output?.url || data.video_url || null,
        error: data.failure || data.error || null
      };
    }
    if (provider === 'replicate') {
      const status = String(data.status || 'starting').toLowerCase();
      const output = Array.isArray(data.output) ? data.output[0] : data.output;
      return { status: ['succeeded', 'successful', 'completed'].includes(status) ? 'completed' : ['failed', 'canceled', 'cancelled'].includes(status) ? 'failed' : 'processing', outputUrl: typeof output === 'string' ? output : output?.url || null, error: data.error || null };
    }
    if (provider === 'luma') {
      const status = String(data.state || 'queued').toLowerCase();
      const output = Array.isArray(data.output) ? data.output.find(item => item.type === 'video') || data.output[0] : null;
      return {
        status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'processing',
        outputUrl: output?.url || null,
        error: data.failure_reason || data.failure_code || null
      };
    }
    const video = data.data?.video || data.data || data;
    const status = String(video.status || 'pending').toLowerCase();
    return {
      status: ['completed', 'success', 'succeeded'].includes(status) ? 'completed' : ['failed', 'error', 'cancelled', 'canceled'].includes(status) ? 'failed' : 'processing',
      outputUrl: video.video_url || video.url || video.download_url || null,
      error: video.error || video.error_message || null
    };
  }

  app.get('/api/studio/motion/estimate', need, (req, res) => {
    const provider = String(req.query.provider || 'runway').toLowerCase();
    if (!['runway', 'luma'].includes(provider)) return res.status(400).json({ error: 'Chagua Runway au Luma.' });
    const duration = Math.round(Number(req.query.durationSeconds) || 5);
    if (![5, 10].includes(duration)) return res.status(400).json({ error: 'Muda unaoruhusiwa ni sekunde 5 au 10.' });
    const rate = getPrice('studio_motion_second_tzs');
    const charge = duration * rate;
    const enabled = Boolean(providerKey(provider) && rate > 0 && cashWalletBalance(db, req.user.id) >= charge);
    res.json({ provider, durationSeconds: duration, customerPricePerSecondTzs: rate, estimatedChargeTzs: charge, walletBalanceTzs: cashWalletBalance(db, req.user.id), enabled, model: provider === 'runway' ? (env.RUNWAY_MODEL || 'seedance2_5') : (env.LUMA_VIDEO_MODEL || 'ray-3.2') });
  });

  app.post('/api/studio/motion/jobs', need, async (req, res) => {
    const provider = String(req.body?.provider || '').toLowerCase();
    const prompt = String(req.body?.prompt || '').trim().slice(0, 1000);
    const duration = Math.round(Number(req.body?.durationSeconds) || 5);
    const ratio = ['16:9', '9:16'].includes(req.body?.aspectRatio) ? req.body.aspectRatio : '16:9';
    if (!['runway', 'luma'].includes(provider)) return res.status(400).json({ error: 'Chagua Runway au Luma.' });
    if (prompt.length < 8) return res.status(400).json({ error: 'Andika maelezo ya motion angalau herufi 8.' });
    if (![5, 10].includes(duration)) return res.status(400).json({ error: 'Muda unaoruhusiwa ni sekunde 5 au 10.' });
    if (!providerKey(provider)) return res.status(503).json({ error: 'API key ya ' + provider + ' haijawekwa kwenye Render.' });
    const rate = getPrice('studio_motion_second_tzs');
    const charge = duration * rate;
    if (Number(req.body?.expectedChargeTzs) !== charge || charge <= 0) return res.status(409).json({ error: 'Bei haijaidhinishwa au imebadilika. Kagua makadirio mapya.' });
    const id = randomUUID();
    try { reserve(req.user.id, charge, 'Mlimani Motion Studio reservation ' + id); }
    catch (error) { return jsonError(res, error); }
    const stamp = now();
    try {
      db.prepare(`INSERT INTO studio_async_jobs
        (id,user_id,provider,job_type,prompt,duration_seconds,charge_tzs,billing_status,status,created_at,updated_at)
        VALUES(?,?,?,'motion',?,?,?,'reserved','submitting',?,?)`)
        .run(id, req.user.id, provider, prompt, duration, charge, stamp, stamp);
      const created = provider === 'runway'
        ? await createRunway(prompt, duration, ratio, req.user.id)
        : await createLuma(prompt, duration, ratio, req.user.id);
      const providerJobId = created.id || created.task_id || created.generation_id;
      if (!providerJobId) throw new Error(provider + ' hakurudisha Job ID.');
      db.prepare('UPDATE studio_async_jobs SET provider_job_id=?,status=?,updated_at=? WHERE id=?')
        .run(String(providerJobId), 'processing', now(), id);
      return res.status(202).json({ jobId: id, provider, status: 'processing', durationSeconds: duration, chargedTzs: charge });
    } catch (error) {
      const job = db.prepare('SELECT * FROM studio_async_jobs WHERE id=?').get(id);
      if (job) { try { refund(job, 'Refund ya Motion Studio: ' + error.message); } catch (refundError) { console.error('Motion refund failed:', id, refundError.message); db.prepare("UPDATE studio_async_jobs SET billing_status='refund_review',status='failed',error=?,updated_at=? WHERE id=?").run('Refund review required', now(), id); } }
      else { try { creditCashWallet(db, req.user.id, charge, 'studio-async-refund:' + id, 'Refund ya Motion Studio iliyoshindwa kuanzishwa'); } catch (refundError) { console.error('Motion reservation refund failed:', id, refundError.message); } }
      return jsonError(res, error, 'Imeshindikana kuanzisha Motion Studio.');
    }
  });

  app.get('/api/studio/avatar-video/estimate', need, (req, res) => {
    const seconds = Math.max(5, Math.min(600, Math.round(Number(req.query.durationSeconds) || 30)));
    const rate = getPrice('studio_avatar_video_second_tzs');
    const charge = seconds * rate;
    const enabled = Boolean(env.HEYGEN_API_KEY && rate > 0 && cashWalletBalance(db, req.user.id) >= charge);
    res.json({ provider: 'HeyGen', durationSeconds: seconds, customerPricePerSecondTzs: rate, estimatedChargeTzs: charge, walletBalanceTzs: cashWalletBalance(db, req.user.id), enabled });
  });

  app.get('/api/studio/animation/estimate', need, (req, res) => {
    const rate = getPrice('studio_animation_tzs');
    const model = String(env.REPLICATE_ANIMATION_MODEL || DEFAULT_REPLICATE_ANIMATION_MODEL).trim();
    const version = String(env.REPLICATE_ANIMATION_VERSION || '').trim();
    const modelConfigured = /^[a-z0-9-]+\/[a-z0-9-]+$/i.test(model) || /^[a-f0-9]{64}$/i.test(version);
    const configured = Boolean(env.REPLICATE_API_TOKEN && modelConfigured);
    res.json({ provider: 'Replicate', customerPricePerAnimationTzs: rate, estimatedChargeTzs: rate, walletBalanceTzs: cashWalletBalance(db, req.user.id), configured, enabled: Boolean(configured && rate > 0 && cashWalletBalance(db, req.user.id) >= rate) });
  });

  app.post('/api/studio/animation/jobs', need, async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim().slice(0, 1200);
    const imageUrl = String(req.body?.imageUrl || '').trim().slice(0, 2000);
    const duration = [5, 10].includes(Number(req.body?.durationSeconds)) ? Number(req.body.durationSeconds) : 5;
    const aspectRatio = ['16:9', '9:16', '1:1'].includes(req.body?.aspectRatio) ? req.body.aspectRatio : '1:1';
    const model = String(env.REPLICATE_ANIMATION_MODEL || DEFAULT_REPLICATE_ANIMATION_MODEL).trim();
    const version = String(env.REPLICATE_ANIMATION_VERSION || '').trim();
    const modelConfigured = /^[a-z0-9-]+\/[a-z0-9-]+$/i.test(model) || /^[a-f0-9]{64}$/i.test(version);
    if (!env.REPLICATE_API_TOKEN || !modelConfigured) return res.status(503).json({ error: 'Replicate animation bado haijasanidiwa. Admin aweke API token na model sahihi.' });
    if (prompt.length < 8) return res.status(400).json({ error: 'Andika maelezo ya animation angalau herufi 8.' });
    if (model === DEFAULT_REPLICATE_ANIMATION_MODEL && !imageUrl) return res.status(400).json({ error: 'Default model ya animation inahitaji picha ya kuanzia yenye HTTPS link.' });
    if (imageUrl) {
      if (req.body?.consentConfirmed !== true) return res.status(400).json({ error: 'Thibitisha kuwa una ruhusa ya kutumia picha hii na mtu aliye kwenye picha ameridhia.' });
      try { const url = new URL(imageUrl); if (url.protocol !== 'https:') throw new Error('bad protocol'); } catch { return res.status(400).json({ error: 'Picha lazima iwe na kiungo salama cha HTTPS.' }); }
    }
    const charge = getPrice('studio_animation_tzs');
    if (Number(req.body?.expectedChargeTzs) !== charge || charge <= 0) return res.status(409).json({ error: 'Bei haijaidhinishwa au imebadilika. Kagua makadirio mapya.' });
    let input;
    try { input = buildReplicateInput(env.REPLICATE_ANIMATION_INPUT_TEMPLATE || DEFAULT_REPLICATE_ANIMATION_TEMPLATE, { prompt, imageUrl, durationSeconds: duration, aspectRatio }); }
    catch (error) { return res.status(503).json({ error: error.message }); }
    const id = randomUUID();
    try { reserve(req.user.id, charge, 'Mlimani Animation Studio reservation ' + id); }
    catch (error) { return jsonError(res, error); }
    const stamp = now();
    try {
      db.prepare("INSERT INTO studio_async_jobs (id,user_id,provider,job_type,prompt,duration_seconds,charge_tzs,billing_status,status,created_at,updated_at) VALUES(?,?,?,'animation',?,?,?,'reserved','submitting',?,?)")
        .run(id, req.user.id, 'replicate', prompt, duration, charge, stamp, stamp);
      const created = await createReplicate(input);
      if (!created.id) throw new Error('Replicate hakurudisha Prediction ID.');
      db.prepare('UPDATE studio_async_jobs SET provider_job_id=?,status=?,updated_at=? WHERE id=?').run(String(created.id), 'processing', now(), id);
      return res.status(202).json({ jobId: id, provider: 'replicate', status: 'processing', durationSeconds: duration, chargedTzs: charge });
    } catch (error) {
      const job = db.prepare('SELECT * FROM studio_async_jobs WHERE id=?').get(id);
      if (job) {
        try { refund(job, 'Refund ya Replicate Animation: ' + error.message); }
        catch (refundError) {
          console.error('Replicate refund failed:', id, refundError.message);
          db.prepare("UPDATE studio_async_jobs SET billing_status='refund_review',status='failed',error=?,updated_at=? WHERE id=?").run('Refund review required', now(), id);
        }
      } else {
        try { creditCashWallet(db, req.user.id, charge, 'studio-async-refund:' + id, 'Refund ya Replicate Animation iliyoshindwa kuanzishwa'); }
        catch (refundError) { console.error('Replicate reservation refund failed:', id, refundError.message); }
      }
      return jsonError(res, error, 'Imeshindikana kuanzisha Animation Studio.');
    }
  });

  app.get('/api/studio/avatar-video/estimate', need, (req, res) => {
    const seconds = Math.max(5, Math.min(600, Math.round(Number(req.query.durationSeconds) || 30)));
    const rate = getPrice('studio_avatar_video_second_tzs');
    const charge = seconds * rate;
    const enabled = Boolean(env.HEYGEN_API_KEY && rate > 0 && cashWalletBalance(db, req.user.id) >= charge);
    res.json({ provider: 'HeyGen', durationSeconds: seconds, customerPricePerSecondTzs: rate, estimatedChargeTzs: charge, walletBalanceTzs: cashWalletBalance(db, req.user.id), enabled });
  });

  app.get('/api/studio/heygen/catalog', need, async (_req, res) => {
    if (!env.HEYGEN_API_KEY) return res.status(503).json({ error: 'HEYGEN_API_KEY haijawekwa kwenye Render.' });
    try {
      const [avatarResponse, voiceResponse] = await Promise.all([
        fetch('https://api.heygen.com/v3/avatars/looks', { headers: { 'X-Api-Key': env.HEYGEN_API_KEY }, signal: AbortSignal.timeout(30000) }),
        fetch('https://api.heygen.com/v3/voices', { headers: { 'X-Api-Key': env.HEYGEN_API_KEY }, signal: AbortSignal.timeout(30000) })
      ]);
      const [avatarData, voiceData] = await Promise.all([parseBody(avatarResponse), parseBody(voiceResponse)]);
      const avatarRows = Array.isArray(avatarData.data) ? avatarData.data : avatarData.data?.looks || avatarData.data?.avatar_looks || avatarData.data?.avatars || avatarData.looks || avatarData.avatar_looks || avatarData.avatars || [];
      const voiceRows = Array.isArray(voiceData.data) ? voiceData.data : voiceData.data?.voices || voiceData.voices || [];
      const avatars = avatarRows.map(item => ({ id: item.id || item.avatar_id || item.look_id, name: item.name || item.avatar_name || 'HeyGen Avatar', previewImageUrl: item.preview_image_url || item.preview_image || null, defaultVoiceId: item.default_voice_id || null })).filter(item => item.id);
      const voices = voiceRows.map(item => ({ id: item.voice_id || item.id, name: item.name || 'HeyGen Voice', language: item.language || item.language_code || null })).filter(item => item.id);
      return res.json({ avatars, voices, avatarCount: avatars.length, voiceCount: voices.length });
    } catch (error) {
      console.error('HeyGen catalog:', error.message);
      return jsonError(res, error, 'Imeshindikana kupata orodha ya HeyGen.');
    }
  });

  app.post('/api/studio/avatar-video/jobs', need, async (req, res) => {
    if (!env.HEYGEN_API_KEY) return res.status(503).json({ error: 'HEYGEN_API_KEY haijawekwa kwenye Render.' });
    const script = String(req.body?.script || '').trim().slice(0, 5000);
    const avatarId = String(req.body?.avatarId || '').trim().slice(0, 200);
    const voiceId = String(req.body?.voiceId || '').trim().slice(0, 200);
    const imageUrl = String(req.body?.imageUrl || '').trim().slice(0, 2000);
    const mode = imageUrl ? 'image' : 'avatar';
    const title = String(req.body?.title || 'Mlimani Avatar Video').trim().slice(0, 120);
    const aspectRatio = ['16:9', '9:16'].includes(req.body?.aspectRatio) ? req.body.aspectRatio : '16:9';
    const resolution = ['720p', '1080p'].includes(req.body?.resolution) ? req.body.resolution : '720p';
    const motionPrompt = String(req.body?.motionPrompt || '').trim().slice(0, 300);
    const expressiveness = ['low', 'medium', 'high'].includes(req.body?.expressiveness) ? req.body.expressiveness : 'medium';
    if (script.length < 3) return res.status(400).json({ error: 'Andika script ya avatar angalau herufi 3.' });
    if (!voiceId) return res.status(400).json({ error: 'Chagua HeyGen Voice ID.' });
    if (mode === 'avatar' && !avatarId) return res.status(400).json({ error: 'Chagua HeyGen Avatar ID.' });
    if (mode === 'image') {
      if (req.body?.consentConfirmed !== true) return res.status(400).json({ error: 'Thibitisha kuwa una ruhusa ya kutumia picha hii na mtu aliye kwenye picha ameridhia.' });
      try { const url = new URL(imageUrl); if (url.protocol !== 'https:') throw new Error('bad protocol'); }
      catch { return res.status(400).json({ error: 'Picha lazima iwe na kiungo salama cha HTTPS.' }); }
    }
    const seconds = voiceSeconds(script);
    const rate = getPrice('studio_avatar_video_second_tzs');
    const charge = seconds * rate;
    if (Number(req.body?.expectedChargeTzs) !== charge || charge <= 0) return res.status(409).json({ error: 'Bei haijaidhinishwa au imebadilika. Kagua makadirio mapya.' });
    const id = randomUUID();
    try { reserve(req.user.id, charge, 'Mlimani HeyGen Avatar Video reservation ' + id); }
    catch (error) { return jsonError(res, error); }
    const input = {
      type: mode,
      ...(mode === 'avatar' ? { avatar_id: avatarId } : { image: { type: 'url', url: imageUrl } }),
      script, voice_id: voiceId, title, resolution, aspect_ratio: aspectRatio
    };
    if (mode === 'image' && motionPrompt) { input.motion_prompt = motionPrompt; input.expressiveness = expressiveness; }
    const stamp = now();
    try {
      db.prepare(`INSERT INTO studio_async_jobs
        (id,user_id,provider,job_type,prompt,duration_seconds,charge_tzs,billing_status,status,created_at,updated_at)
        VALUES(?,?,?,'avatar_video',?,?,?,'reserved','submitting',?,?)`)
        .run(id, req.user.id, 'heygen', script, seconds, charge, stamp, stamp);
      const created = await createHeyGen(input);
      const video = created.data?.video || created.data || created;
      const providerJobId = video.video_id || video.id;
      if (!providerJobId) throw new Error('HeyGen hakurudisha Video ID.');
      db.prepare('UPDATE studio_async_jobs SET provider_job_id=?,status=?,updated_at=? WHERE id=?')
        .run(String(providerJobId), String(video.status || 'processing').toLowerCase(), now(), id);
      return res.status(202).json({ jobId: id, provider: 'heygen', status: 'processing', durationSeconds: seconds, chargedTzs: charge });
    } catch (error) {
      const job = db.prepare('SELECT * FROM studio_async_jobs WHERE id=?').get(id);
      if (job) { try { refund(job, 'Refund ya HeyGen Avatar Video: ' + error.message); } catch (refundError) { console.error('HeyGen refund failed:', id, refundError.message); db.prepare("UPDATE studio_async_jobs SET billing_status='refund_review',status='failed',error=?,updated_at=? WHERE id=?").run('Refund review required', now(), id); } }
      else { try { creditCashWallet(db, req.user.id, charge, 'studio-async-refund:' + id, 'Refund ya HeyGen iliyoshindwa kuanzishwa'); } catch (refundError) { console.error('HeyGen reservation refund failed:', id, refundError.message); } }
      return jsonError(res, error, 'Imeshindikana kuanzisha HeyGen Avatar Video.');
    }
  });

  app.get('/api/studio/async-jobs/:id', need, async (req, res) => {
    const job = db.prepare('SELECT * FROM studio_async_jobs WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!job) return res.status(404).json({ error: 'Kazi haipatikani.' });
    if (['completed', 'failed'].includes(job.status) || !job.provider_job_id) {
      return res.json({ jobId: job.id, provider: job.provider, jobType: job.job_type, status: job.status, outputUrl: job.output_url, error: job.error, billingStatus: job.billing_status, chargedTzs: job.charge_tzs });
    }
    try {
      const data = job.provider === 'runway' ? await getRunway(job.provider_job_id)
        : job.provider === 'luma' ? await getLuma(job.provider_job_id)
        : job.provider === 'replicate' ? await getReplicate(job.provider_job_id)
        : await getHeyGen(job.provider_job_id);
      const normalized = normalizeJob(job.provider, data);
      if (normalized.status === 'failed') {
        try { refund(job, normalized.error || 'Mtoa huduma ameshindwa kutengeneza video.'); }
        catch (error) {
          console.error('Studio async refund failed:', job.id, error.message);
          db.prepare("UPDATE studio_async_jobs SET billing_status='refund_review',status='failed',error=?,updated_at=? WHERE id=?").run('Refund review required', now(), job.id);
        }
        return res.json({ jobId: job.id, provider: job.provider, status: 'failed', error: normalized.error || 'Generation failed', billingStatus: db.prepare('SELECT billing_status FROM studio_async_jobs WHERE id=?').get(job.id)?.billing_status || 'refund_review' });
      }
      if (normalized.status === 'completed') {
        db.prepare("UPDATE studio_async_jobs SET status='completed',output_url=?,updated_at=? WHERE id=?")
          .run(normalized.outputUrl, now(), job.id);
        return res.json({ jobId: job.id, provider: job.provider, jobType: job.job_type, status: 'completed', outputUrl: normalized.outputUrl, billingStatus: job.billing_status, chargedTzs: job.charge_tzs });
      }
      db.prepare("UPDATE studio_async_jobs SET status='processing',updated_at=? WHERE id=?").run(now(), job.id);
      return res.json({ jobId: job.id, provider: job.provider, status: 'processing', billingStatus: job.billing_status, chargedTzs: job.charge_tzs });
    } catch (error) {
      console.error('Studio async job poll:', job.id, error.message);
      return jsonError(res, error, 'Imeshindikana kuangalia maendeleo ya kazi.');
    }
  });
}
