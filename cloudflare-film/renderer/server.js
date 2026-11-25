import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 8080);
const MAX_SCENES = 120;
const MAX_CLIP_BYTES = 150 * 1024 * 1024;
const MAX_NORMALIZED_BYTES = 5 * 1024 * 1024 * 1024;

function safeR2Url(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".r2.cloudflarestorage.com")) {
    throw new Error("Signed URL ya R2 si salama.");
  }
  return parsed;
}

async function download(url, destination) {
  safeR2Url(url);
  const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Imeshindikana kupakua scene (HTTP ${response.status}).`);
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > MAX_CLIP_BYTES) throw new Error("Scene moja imezidi ukubwa unaoruhusiwa.");
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: "wx" }));
  const file = await stat(destination);
  if (!file.size || file.size > MAX_CLIP_BYTES) throw new Error("Ukubwa wa scene si sahihi.");
}

async function runFfmpeg(args, label) {
  try {
    await execFileAsync("ffmpeg", args, { timeout: 60 * 60 * 1000, maxBuffer: 24 * 1024 * 1024 });
  } catch (error) {
    const detail = String(error.stderr || error.message || "").slice(-1200);
    throw new Error(`${label}: ${detail}`);
  }
}

async function runFfprobe(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0 || duration > 1805) {
    throw new Error("Muda wa filamu iliyotengenezwa si sahihi au umezidi dakika 30.");
  }
  return duration;
}

async function assemble(payload) {
  const { jobId, sceneUrls, outputUploadUrl } = payload || {};
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(String(jobId || ""))) throw new Error("Job ID si sahihi.");
  if (!Array.isArray(sceneUrls) || sceneUrls.length < 1 || sceneUrls.length > MAX_SCENES) {
    throw new Error("Idadi ya scenes si sahihi.");
  }
  safeR2Url(outputUploadUrl);
  for (const url of sceneUrls) safeR2Url(url);

  const workDir = await mkdtemp(path.join(os.tmpdir(), "mlimani-film-"));
  try {
    const normalizedDir = path.join(workDir, "normalized");
    await mkdir(normalizedDir);
    const concatFile = path.join(workDir, "concat.txt");
    const normalizedFiles = [];
    let normalizedBytes = 0;

    for (let index = 0; index < sceneUrls.length; index++) {
      const number = String(index + 1).padStart(3, "0");
      const rawPath = path.join(workDir, `raw-${number}.mp4`);
      const normalizedPath = path.join(normalizedDir, `scene-${number}.mp4`);
      await download(sceneUrls[index], rawPath);
      await runFfmpeg([
        "-y", "-hide_banner", "-loglevel", "error", "-i", rawPath,
        "-map", "0:v:0",
        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", normalizedPath
      ], `Kushindwa kusawazisha scene ${index + 1}`);
      const normalizedStat = await stat(normalizedPath);
      normalizedBytes += normalizedStat.size;
      if (normalizedBytes > MAX_NORMALIZED_BYTES) {
        throw new Error("Filamu imezidi kikomo cha muda cha kuhifadhi wakati wa kuunganisha.");
      }
      normalizedFiles.push(normalizedPath);
      await rm(rawPath, { force: true });
    }

    const concatLines = normalizedFiles.map(file => `file '${file}'`).join("\n") + "\n";
    await (await import("node:fs/promises")).writeFile(concatFile, concatLines, "utf8");
    const outputPath = path.join(workDir, "final.mp4");
    await runFfmpeg([
      "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
      "-i", concatFile, "-c", "copy", "-movflags", "+faststart", outputPath
    ], "Kushindwa kuunganisha scenes");

    const durationSeconds = await runFfprobe(outputPath);
    const outputStat = await stat(outputPath);
    if (outputStat.size > 6 * 1024 * 1024 * 1024) throw new Error("Filamu ya mwisho imezidi kikomo cha ukubwa.");
    const uploadUrl = safeR2Url(outputUploadUrl);
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "video/mp4", "content-length": String(outputStat.size) },
      body: Readable.toWeb(createReadStream(outputPath)),
      duplex: "half",
      signal: AbortSignal.timeout(60 * 60 * 1000)
    });
    if (!upload.ok) throw new Error(`Imeshindikana kuhifadhi filamu R2 (HTTP ${upload.status}).`);
    return { ok: true, jobId, durationSeconds, sizeBytes: outputStat.size };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (request, response) => {
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200); response.end(JSON.stringify({ ok: true, renderer: "ffmpeg" })); return;
  }
  if (request.method !== "POST" || request.url !== "/assemble") {
    response.writeHead(404); response.end(JSON.stringify({ error: "Route haipo." })); return;
  }
  try {
    let raw = "";
    for await (const chunk of request) {
      raw += chunk.toString("utf8");
      if (raw.length > 512 * 1024) throw new Error("Ombi limezidi ukubwa.");
    }
    const result = await assemble(JSON.parse(raw));
    response.writeHead(200); response.end(JSON.stringify(result));
  } catch (error) {
    console.error("Film assembly failed:", error);
    response.writeHead(500);
    response.end(JSON.stringify({ ok: false, error: String(error.message || error).slice(0, 1500) }));
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`Mlimani FFmpeg renderer listening on ${PORT}`));
