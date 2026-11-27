import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PREFIX = 'mlimani-studio/library/';
const AUDIO_TYPES = new Set(['audio/wav','audio/mpeg','audio/mp3','audio/ogg','audio/mp4','audio/webm']);

export function registerStudioLibraryRoutes(app, { need, admin, studioS3, R2_BUCKET, studioSafeName, randomUUID }) {
  app.get('/api/studio/library', need, async (_req, res) => {
    if (!studioS3) return res.status(503).json({ error: 'Maktaba ya sauti inahitaji Cloudflare R2 kusanidiwa na Admin.' });
    try {
      const listed = await studioS3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: PREFIX + 'metadata/', MaxKeys: 200 }));
      const assets = [];
      for (const item of listed.Contents || []) {
        if (!item.Key?.endsWith('.json')) continue;
        try {
          const obj = await studioS3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: item.Key }));
          const asset = JSON.parse(await obj.Body.transformToString());
          if (asset.published === true && asset.storageKey) {
            asset.url = await getSignedUrl(studioS3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: asset.storageKey }), { expiresIn: 3600 });
            assets.push(asset);
          }
        } catch {}
      }
      assets.sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      res.set('Cache-Control', 'no-store').json({ assets });
    } catch (error) {
      console.error('Mlimani sound library list:', error.message);
      res.status(502).json({ error: 'Imeshindikana kufungua Mlimani Sound Library.' });
    }
  });

  app.post('/api/admin/studio/library/presign', admin, async (req, res) => {
    if (!studioS3) return res.status(503).json({ error: 'Cloudflare R2 haijaunganishwa. Hakuna faili lililopakiwa.' });
    const filename = studioSafeName(req.body?.filename);
    const contentType = String(req.body?.contentType || '').toLowerCase().split(';')[0];
    const sizeBytes = Number(req.body?.sizeBytes);
    const title = String(req.body?.title || '').trim().slice(0,100);
    const category = String(req.body?.category || 'African Modern Percussion').trim().slice(0,60);
    const durationSeconds = Math.max(0, Math.min(600, Number(req.body?.durationSeconds) || 0));
    const description = String(req.body?.description || '').trim().slice(0,500);
    if (!AUDIO_TYPES.has(contentType)) return res.status(415).json({ error: 'Tumia faili la WAV, MP3, OGG, M4A au WEBM audio.' });
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 50 * 1024 * 1024) return res.status(413).json({ error: 'Faili la sauti lisizidi MB 50.' });
    if (!title) return res.status(400).json({ error: 'Weka jina la soundtrack.' });
    const assetId = randomUUID();
    const storageKey = PREFIX + 'audio/' + assetId + '/' + filename;
    try {
      const uploadUrl = await getSignedUrl(studioS3, new PutObjectCommand({
        Bucket: R2_BUCKET, Key: storageKey, ContentType: contentType,
        Metadata: { owner: 'mlimani-admin', asset: assetId, 'expected-size': String(sizeBytes) }
      }), { expiresIn: 900 });
      res.json({
        assetId, storageKey, uploadUrl, expiresIn: 900,
        headers: { 'Content-Type': contentType, 'x-amz-meta-owner': 'mlimani-admin', 'x-amz-meta-asset': assetId, 'x-amz-meta-expected-size': String(sizeBytes) },
        metadata: { title, category, durationSeconds, description, filename, contentType, sizeBytes }
      });
    } catch (error) {
      console.error('Mlimani library presign:', error.message);
      res.status(502).json({ error: 'Imeshindikana kuandaa upload salama.' });
    }
  });

  app.post('/api/admin/studio/library/complete', admin, async (req, res) => {
    if (!studioS3) return res.status(503).json({ error: 'Cloudflare R2 haijaunganishwa.' });
    const assetId = String(req.body?.assetId || '');
    const storageKey = String(req.body?.storageKey || '');
    if (!/^[a-f0-9-]{36}$/i.test(assetId) || !storageKey.startsWith(PREFIX + 'audio/' + assetId + '/')) return res.status(400).json({ error: 'Asset ID au storage key si sahihi.' });
    try {
      const head = await studioS3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }));
      if (head.Metadata?.owner !== 'mlimani-admin' || head.Metadata?.asset !== assetId || Number(head.ContentLength || 0) !== Number(head.Metadata?.['expected-size'] || -1)) {
        await studioS3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }));
        return res.status(403).json({ error: 'Faili halijathibitishwa; limeondolewa.' });
      }
      const input = req.body?.metadata || {};
      const asset = {
        id: assetId, code: String(input.code || 'MLM-SND-001').slice(0,40),
        title: String(input.title || 'Mlimani African Pulse').trim().slice(0,100),
        category: String(input.category || 'African Modern Percussion').trim().slice(0,60),
        description: String(input.description || '').trim().slice(0,500),
        durationSeconds: Math.max(0, Math.min(600, Number(input.durationSeconds) || 0)),
        filename: storageKey.split('/').pop(), contentType: head.ContentType || 'audio/wav',
        sizeBytes: Number(head.ContentLength || 0), storageKey,
        creator: 'Mlimani Labs', rights: 'Original Mlimani digital audio; no third-party samples supplied.',
        permittedUse: 'Use in customer video, presentation and creative projects inside Mlimani Studio. Standalone resale or redistribution of the audio file is not included.',
        published: true, createdAt: Date.now()
      };
      await studioS3.send(new PutObjectCommand({
        Bucket: R2_BUCKET, Key: PREFIX + 'metadata/' + assetId + '.json',
        Body: JSON.stringify(asset), ContentType: 'application/json',
        Metadata: { owner: 'mlimani-admin', asset: assetId }
      }));
      res.json({ ok: true, asset });
    } catch (error) {
      console.error('Mlimani library complete:', error.message);
      res.status(502).json({ error: 'Imeshindikana kuthibitisha na kuchapisha soundtrack.' });
    }
  });

  app.delete('/api/admin/studio/library/:id', admin, async (req, res) => {
    if (!studioS3) return res.status(503).json({ error: 'Cloudflare R2 haijaunganishwa.' });
    const assetId = String(req.params.id || '');
    if (!/^[a-f0-9-]{36}$/i.test(assetId)) return res.status(400).json({ error: 'Asset ID si sahihi.' });
    const metadataKey = PREFIX + 'metadata/' + assetId + '.json';
    try {
      const obj = await studioS3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: metadataKey }));
      const asset = JSON.parse(await obj.Body.transformToString());
      if (asset.storageKey) await studioS3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: asset.storageKey }));
      await studioS3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: metadataKey }));
      res.json({ ok: true });
    } catch (error) {
      res.status(404).json({ error: 'Soundtrack haijapatikana kwenye library.' });
    }
  });
}
