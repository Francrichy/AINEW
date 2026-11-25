import { randomUUID } from 'node:crypto';

const jsonError = async response => {
  const data = await response.json().catch(() => ({}));
  const detail = Array.isArray(data.errors) ? data.errors.join('; ') : data.message || data.error || data.title;
  return String(detail || 'Mtoa huduma amekataa ombi (HTTP ' + response.status + ').').slice(0, 500);
};

export function estimateVoiceMinutes(text) {
  const words = String(text || '').trim().split(/\\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 150));
}

export function registerStudioProviderRoutes(app, { db, need, env, cashWalletBalance, consumeWalletCredits, creditCashWallet }) {
  const now = () => Date.now();
  const price = key => Number(db.prepare('SELECT customer_price FROM admin_pricing WHERE config_key=?').get(key)?.customer_price || 0);
  const ensurePrice = (key, label, service, notes) => db.prepare(`INSERT OR IGNORE INTO admin_pricing
    (config_key,label,service,unit,provider_cost,customer_price,currency,notes,updated_at)
    VALUES(?,?,?,'per_minute',0,0,'TZS',?,?)`).run(key, label, service, notes, now());
  ensurePrice('studio_speech_minute_tzs', 'Mlimani Studio Speech Recognition kwa dakika', 'studio_speech', 'Bei ya mteja kwa dakika ya audio; weka baada ya kuthibitisha gharama za Deepgram na ubora wa Kiswahili.');
  ensurePrice('studio_image_tzs', 'Mlimani Studio Image kwa picha', 'studio_image', 'Bei ya mteja kwa picha; weka baada ya kuthibitisha gharama za Stability AI.');

  const reserve = (userId, amount, description) => {
    if (!(amount > 0)) throw Object.assign(new Error('Bei ya huduma haijaidhinishwa na Admin.'), { status: 503 });
    if (cashWalletBalance(db, userId) < amount) throw Object.assign(new Error('Salio la Wallet halitoshi. Unahitaji TZS ' + amount.toLocaleString('en-US') + '.'), { status: 402 });
    consumeWalletCredits(db, userId, 'cash', amount, description);
  };
  const refund = (userId, amount, description) => {
    if (amount > 0) creditCashWallet(db, userId, amount, 'studio-provider-refund:' + randomUUID(), description);
  };

  app.get('/api/studio/voice/estimate', need, (req, res) => {
    const transcript = String(req.query.text || '').slice(0, 10000);
    const minutes = estimateVoiceMinutes(transcript);
    const rate = price('studio_voice_minute_tzs');
    const charge = minutes * rate;
    res.json({ estimatedMinutes: minutes, customerPricePerMinuteTzs: rate, estimatedChargeTzs: charge, walletBalanceTzs: cashWalletBalance(db, req.user.id), enabled: Boolean(env.CARTESIA_API_KEY && (req.query.voiceId || env.CARTESIA_VOICE_ID) && rate > 0 && cashWalletBalance(db, req.user.id) >= charge), provider: 'Cartesia' });
  });

  app.post('/api/studio/voice', need, async (req, res) => {
    const transcript = String(req.body?.text || '').trim();
    const voiceId = String(req.body?.voiceId || env.CARTESIA_VOICE_ID || '').trim();
    const language = ['sw', 'en'].includes(req.body?.language) ? req.body.language : undefined;
    if (transcript.length < 3 || transcript.length > 10000) return res.status(400).json({ error: 'Weka maandishi yenye herufi 3 hadi 10,000.' });
    if (!env.CARTESIA_API_KEY) return res.status(503).json({ error: 'Cartesia haijaunganishwa. Admin aweke CARTESIA_API_KEY kwenye Render.' });
    if (!voiceId) return res.status(503).json({ error: 'Chagua Cartesia Voice ID au Admin aweke CARTESIA_VOICE_ID.' });
    const minutes = estimateVoiceMinutes(transcript);
    const charge = minutes * price('studio_voice_minute_tzs');
    const expected = Number(req.body?.expectedChargeTzs);
    if (!Number.isFinite(expected) || expected !== charge) return res.status(409).json({ error: 'Bei imebadilika. Kagua makadirio mapya kabla ya kuendelea.', estimatedChargeTzs: charge });
    try { reserve(req.user.id, charge, 'Mlimani Studio Voice reservation (' + minutes + ' dakika)'); }
    catch (error) { return res.status(error.status || 402).json({ error: error.message }); }
    let reserved = true;
    try {
      const payload = { model_id: env.CARTESIA_MODEL_ID || 'sonic-3.5', transcript, voice: { mode: 'id', id: voiceId }, output_format: { container: 'mp3', sample_rate: 44100 } };
      if (language) payload.language = language;
      const response = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST', headers: { Authorization: 'Bearer ' + env.CARTESIA_API_KEY, 'Cartesia-Version': '2026-03-01', 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) throw new Error('Cartesia: ' + await jsonError(response));
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length || audio.length > 30 * 1024 * 1024) throw new Error('Faili la sauti si sahihi au ni kubwa mno.');
      reserved = false;
      res.set({ 'Content-Type': response.headers.get('content-type') || 'audio/mpeg', 'Content-Disposition': 'attachment; filename="mlimani-voice.mp3"', 'Cache-Control': 'private, no-store', 'X-Studio-Charged-Tzs': String(charge) });
      return res.send(audio);
    } catch (error) {
      if (reserved) { try { refund(req.user.id, charge, 'Refund ya Cartesia Voice iliyoshindwa'); } catch (e) { console.error('Cartesia refund failed:', e.message); } }
      console.error('Cartesia voice error:', error.message);
      return res.status(502).json({ error: 'Imeshindikana kutengeneza sauti. ' + error.message.slice(0, 300) });
    }
  });

  app.get('/api/studio/speech/estimate', need, (req, res) => {
    const seconds = Math.max(1, Math.min(600, Math.round(Number(req.query.durationSeconds) || 60)));
    const minutes = Math.ceil(seconds / 60);
    const rate = price('studio_speech_minute_tzs');
    const charge = minutes * rate;
    res.json({ durationSeconds: seconds, billedMinutes: minutes, customerPricePerMinuteTzs: rate, estimatedChargeTzs: charge, walletBalanceTzs: cashWalletBalance(db, req.user.id), enabled: Boolean(env.DEEPGRAM_API_KEY && rate > 0 && cashWalletBalance(db, req.user.id) >= charge), provider: 'Deepgram' });
  });

  app.post('/api/studio/speech/transcribe', need, async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Pakia faili la sauti kwanza.' });
    if (req.body.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Faili lisizidi MB 25 kwa sasa.' });
    const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    if (!/^(audio\\/(mpeg|mp3|wav|webm|ogg|mp4|m4a|flac)|video\\/(mp4|webm|quicktime)|application\\/octet-stream)$/.test(contentType)) return res.status(415).json({ error: 'Aina ya faili hairuhusiwi. Tumia MP3, WAV, M4A, WEBM au MP4.' });
    if (!env.DEEPGRAM_API_KEY) return res.status(503).json({ error: 'Deepgram haijaunganishwa. Admin aweke DEEPGRAM_API_KEY kwenye Render.' });
    const expectedSeconds = Math.round(Number(req.headers['x-audio-duration-seconds']) || 0);
    if (!Number.isFinite(expectedSeconds) || expectedSeconds < 1 || expectedSeconds > 600) return res.status(400).json({ error: 'Muda wa sauti lazima uwe kati ya sekunde 1 na 600.' });
    const rate = price('studio_speech_minute_tzs');
    const reservedMinutes = Math.ceil(expectedSeconds / 60);
    const reservedCharge = reservedMinutes * rate;
    try { reserve(req.user.id, reservedCharge, 'Mlimani Speech Recognition reservation (' + reservedMinutes + ' dakika)'); }
    catch (error) { return res.status(error.status || 402).json({ error: error.message }); }
    let reserved = true;
    try {
      const language = ['sw', 'en'].includes(String(req.query.language || '')) ? String(req.query.language) : 'sw';
      const url = new URL('https://api.deepgram.com/v1/listen');
      url.searchParams.set('model', env.DEEPGRAM_MODEL_ID || 'nova-3');
      url.searchParams.set('smart_format', 'true');
      url.searchParams.set('punctuate', 'true');
      url.searchParams.set('language', language);
      const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Token ' + env.DEEPGRAM_API_KEY, 'Content-Type': contentType }, body: req.body, signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error('Deepgram: ' + await jsonError(response));
      const data = await response.json();
      const duration = Math.max(0, Number(data.metadata?.duration) || expectedSeconds);
      const actualCharge = Math.ceil(Math.max(1, duration) / 60) * rate;
      if (actualCharge > reservedCharge) {
        try { consumeWalletCredits(db, req.user.id, 'cash', actualCharge - reservedCharge, 'Mlimani Speech Recognition adjustment'); }
        catch { throw Object.assign(new Error('Muda halisi wa faili ni mrefu kuliko makadirio na salio halitoshi. Hakuna transcript iliyotolewa.'), { status: 402 }); }
      } else if (reservedCharge > actualCharge) refund(req.user.id, reservedCharge - actualCharge, 'Refund ya dakika za Speech Recognition ambazo hazikutumika');
      reserved = false;
      const channel = data.results?.channels?.[0]?.alternatives?.[0] || {};
      return res.json({ transcript: channel.transcript || '', confidence: channel.confidence ?? null, durationSeconds: duration, chargedTzs: actualCharge, language, words: channel.words || [] });
    } catch (error) {
      if (reserved) { try { refund(req.user.id, reservedCharge, 'Refund ya Deepgram Speech Recognition iliyoshindwa'); } catch (e) { console.error('Deepgram refund failed:', e.message); } }
      console.error('Deepgram speech error:', error.message);
      return res.status(error.status || 502).json({ error: error.message.slice(0, 400) });
    }
  });

  app.get('/api/studio/image/estimate', need, (_req, res) => {
    const rate = price('studio_image_tzs');
    res.json({ customerPricePerImageTzs: rate, estimatedChargeTzs: rate, walletBalanceTzs: cashWalletBalance(db, _req.user.id), enabled: Boolean(env.STABILITY_API_KEY && rate > 0 && cashWalletBalance(db, _req.user.id) >= rate), provider: 'Stability AI' });
  });

  app.post('/api/studio/image', need, async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim().slice(0, 2000);
    const aspectRatio = ['1:1', '16:9', '9:16', '4:5', '3:2', '2:3'].includes(req.body?.aspectRatio) ? req.body.aspectRatio : '1:1';
    if (prompt.length < 8) return res.status(400).json({ error: 'Andika maelezo ya picha angalau herufi 8.' });
    if (!env.STABILITY_API_KEY) return res.status(503).json({ error: 'Stability AI haijaunganishwa. Admin aweke STABILITY_API_KEY kwenye Render.' });
    const charge = price('studio_image_tzs');
    const expected = Number(req.body?.expectedChargeTzs);
    if (!Number.isFinite(expected) || expected !== charge || charge <= 0) return res.status(409).json({ error: 'Bei haijaidhinishwa au imebadilika. Kagua makadirio mapya.' });
    try { reserve(req.user.id, charge, 'Mlimani Studio Image reservation'); }
    catch (error) { return res.status(error.status || 402).json({ error: error.message }); }
    let reserved = true;
    try {
      const form = new FormData();
      form.append('prompt', prompt);
      form.append('aspect_ratio', aspectRatio);
      form.append('output_format', 'png');
      const response = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
        method: 'POST', headers: { Authorization: 'Bearer ' + env.STABILITY_API_KEY, Accept: 'image/*' }, body: form, signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) throw new Error('Stability AI: ' + await jsonError(response));
      const image = Buffer.from(await response.arrayBuffer());
      if (!image.length || image.length > 20 * 1024 * 1024) throw new Error('Faili la picha si sahihi au ni kubwa mno.');
      reserved = false;
      res.set({ 'Content-Type': response.headers.get('content-type') || 'image/png', 'Content-Disposition': 'attachment; filename="mlimani-image.png"', 'Cache-Control': 'private, no-store', 'X-Studio-Charged-Tzs': String(charge) });
      return res.send(image);
    } catch (error) {
      if (reserved) { try { refund(req.user.id, charge, 'Refund ya Stability AI Image iliyoshindwa'); } catch (e) { console.error('Stability refund failed:', e.message); } }
      console.error('Stability image error:', error.message);
      return res.status(502).json({ error: 'Imeshindikana kutengeneza picha. ' + error.message.slice(0, 300) });
    }
  });
}
