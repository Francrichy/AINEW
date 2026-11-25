import { WorkflowEntrypoint } from "cloudflare:workers";
import { Container } from "@cloudflare/containers";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { validateFilmRequest } from "./validation.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function writeManifest(bucket, jobId, manifest) {
  manifest.updatedAt = new Date().toISOString();
  await bucket.put(`film-jobs/${jobId}/manifest.json`, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" }
  });
}

async function readManifest(bucket, jobId) {
  const object = await bucket.get(`film-jobs/${jobId}/manifest.json`);
  if (!object) return null;
  return object.json();
}

function r2Signer(env) {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 signing credentials hazijawekwa.");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    }
  });
}

function authorized(request, env) {
  const expected = env.MLIMANI_INTERNAL_TOKEN;
  const supplied = request.headers.get("authorization") || "";
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

export class FilmRenderer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
}

export class FilmWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const { jobId, ownerId, title, language, scenes } = event.payload;
    try {
    await step.do("load-film-manifest", async () => {
      const current = await readManifest(env.FILM_MEDIA, jobId);
      if (!current) throw new Error("Film manifest haipo.");
      current.status = "generating";
      current.totalScenes = scenes.length;
      current.completedScenes = current.completedScenes || 0;
      await writeManifest(env.FILM_MEDIA, jobId, current);
      return { jobId, totalScenes: scenes.length };
    });

    for (let index = 0; index < scenes.length; index++) {
      const scene = scenes[index];
      const sceneNumber = index + 1;
      const objectKey = `film-jobs/${jobId}/scenes/scene-${String(sceneNumber).padStart(3, "0")}.mp4`;
      await step.do(`generate-scene-${sceneNumber}`, {
        retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
        timeout: "6 minutes"
      }, async () => {
        const existing = await env.FILM_MEDIA.head(objectKey);
        if (!existing) {
          if (!env.POLLINATIONS_API_KEY) throw new Error("POLLINATIONS_API_KEY haijawekwa.");
          const model = env.VIDEO_MODEL || "bytedance/seedance-2.0";
          const videoUrl = `https://gen.pollinations.ai/video/${encodeURIComponent(scene.prompt)}?model=${encodeURIComponent(model)}&duration=${scene.duration}&aspectRatio=${encodeURIComponent(scene.aspectRatio)}`;
          const response = await fetch(videoUrl, {
            headers: { Authorization: `Bearer ${env.POLLINATIONS_API_KEY}`, Accept: "video/mp4" },
            signal: AbortSignal.timeout(330000)
          });
          const contentType = response.headers.get("content-type") || "";
          if (!response.ok || !contentType.startsWith("video/") || !response.body) {
            const detail = (await response.text().catch(() => "")).slice(0, 300);
            throw new Error(`Video provider failed for scene ${sceneNumber}: HTTP ${response.status} ${detail}`);
          }
          await env.FILM_MEDIA.put(objectKey, response.body, {
            httpMetadata: { contentType: "video/mp4" },
            customMetadata: { jobId, ownerId, scene: String(sceneNumber), duration: String(scene.duration) }
          });
        }

        const latest = await readManifest(env.FILM_MEDIA, jobId);
        const done = new Set(latest.completedSceneNumbers || []);
        done.add(sceneNumber);
        latest.completedSceneNumbers = [...done].sort((a, b) => a - b);
        latest.completedScenes = latest.completedSceneNumbers.length;
        latest.progressPercent = Math.floor((latest.completedScenes / scenes.length) * 85);
        latest.scenes[sceneNumber - 1] = {
          number: sceneNumber, status: "stored", objectKey, duration: scene.duration
        };
        await writeManifest(env.FILM_MEDIA, jobId, latest);
        return { sceneNumber, objectKey };
      });
    }

    await step.do("assemble-final-film-with-ffmpeg", {
      retries: { limit: 2, delay: "30 seconds", backoff: "exponential" },
      timeout: "4 hours"
    }, async () => {
      const latest = await readManifest(env.FILM_MEDIA, jobId);
      latest.status = "assembling";
      latest.progressPercent = 90;
      latest.assembly = { status: "working", required: true };
      await writeManifest(env.FILM_MEDIA, jobId, latest);

      const signer = r2Signer(env);
      const bucketName = env.R2_BUCKET_NAME || "mlimani-studio-media";
      const expiresIn = 12 * 60 * 60;
      const sceneUrls = await Promise.all(scenes.map((scene, index) => {
        const key = `film-jobs/${jobId}/scenes/scene-${String(index + 1).padStart(3, "0")}.mp4`;
        return getSignedUrl(signer, new GetObjectCommand({ Bucket: bucketName, Key: key }), { expiresIn });
      }));
      const outputKey = `film-jobs/${jobId}/final.mp4`;
      const outputUploadUrl = await getSignedUrl(
        signer,
        new PutObjectCommand({ Bucket: bucketName, Key: outputKey, ContentType: "video/mp4" }),
        { expiresIn }
      );

      const renderer = env.FILM_RENDERER.getByName(jobId);
      const renderResponse = await renderer.fetch(new Request("http://container/assemble", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, sceneUrls, outputUploadUrl })
      }));
      const renderResult = await renderResponse.json().catch(() => ({}));
      if (!renderResponse.ok || !renderResult.ok) {
        throw new Error(renderResult.error || `FFmpeg renderer failed (HTTP ${renderResponse.status}).`);
      }

      const completed = await readManifest(env.FILM_MEDIA, jobId);
      completed.status = "completed";
      completed.progressPercent = 100;
      completed.output = {
        objectKey: outputKey,
        durationSeconds: renderResult.durationSeconds,
        sizeBytes: renderResult.sizeBytes,
        contentType: "video/mp4"
      };
      completed.assembly = { status: "completed", renderer: "cloudflare-container-ffmpeg" };
      await writeManifest(env.FILM_MEDIA, jobId, completed);
      return completed.output;
    });

    return { jobId, status: "completed", title, language };
    } catch (error) {
      const failed = await readManifest(env.FILM_MEDIA, jobId).catch(() => null);
      if (failed) {
        failed.status = "failed";
        failed.error = String(error?.message || error).slice(0, 500);
        await writeManifest(env.FILM_MEDIA, jobId, failed).catch(() => {});
      }
      throw error;
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "mlimani-film-orchestrator" });
    }
    if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);

    if (request.method === "POST" && url.pathname === "/jobs") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "JSON si sahihi." }, 400); }
      const checked = validateFilmRequest(body, Number(env.MAX_SCENES || 120));
      if (!checked.ok) return json({ error: checked.error }, 400);

      const jobId = crypto.randomUUID();
      const payload = { jobId, ...checked.value };
      const manifest = {
        jobId, ownerId: payload.ownerId, title: payload.title, language: payload.language,
        status: "queued", totalScenes: payload.scenes.length, completedScenes: 0,
        completedSceneNumbers: [], progressPercent: 0, createdAt: new Date().toISOString(),
        scenes: payload.scenes.map((scene, index) => ({
          number: index + 1, status: "queued", duration: scene.duration
        })),
        assembly: { status: "waiting_for_scenes", required: true }
      };
      await writeManifest(env.FILM_MEDIA, jobId, manifest);
      try {
        await env.FILM_WORKFLOW.create({ id: jobId, params: payload });
      } catch (error) {
        manifest.status = "failed_to_start";
        manifest.error = String(error?.message || error).slice(0, 300);
        await writeManifest(env.FILM_MEDIA, jobId, manifest);
        return json({ error: "Imeshindikana kuanzisha workflow.", jobId }, 502);
      }
      return json({ jobId, status: "queued", totalScenes: payload.scenes.length }, 202);
    }

    const downloadMatch = url.pathname.match(/^\/jobs\/([a-zA-Z0-9-]+)\/download$/);
    if (request.method === "GET" && downloadMatch) {
      const manifest = await readManifest(env.FILM_MEDIA, downloadMatch[1]);
      if (!manifest || String(manifest.ownerId) !== String(url.searchParams.get("ownerId") || "")) return json({ error: "Kazi haipo." }, 404);
      if (manifest.status !== "completed" || !manifest.output?.objectKey) return json({ error: "Filamu bado haijakamilika." }, 409);
      const signer = r2Signer(env);
      const bucketName = env.R2_BUCKET_NAME || "mlimani-studio-media";
      const expiresIn = 600;
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: manifest.output.objectKey,
        ResponseContentDisposition: 'attachment; filename="mlimani-film.mp4"'
      });
      const signedUrl = await getSignedUrl(signer, command, { expiresIn });
      return json({ url: signedUrl, expiresIn });
    }

    const match = url.pathname.match(/^\/jobs\/([a-zA-Z0-9-]+)$/);
    if (request.method === "GET" && match) {
      const manifest = await readManifest(env.FILM_MEDIA, match[1]);
      if (!manifest || String(manifest.ownerId) !== String(url.searchParams.get("ownerId") || "")) return json({ error: "Kazi haipo." }, 404);
      return json(manifest);
    }
    return json({ error: "Route haipo." }, 404);
  }
};
