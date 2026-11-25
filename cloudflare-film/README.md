# Mlimani Cloudflare Film Orchestrator

This is an isolated Cloudflare Worker + Workflows + R2 + Containers service. It does not replace the existing Render-hosted Mlimani AI website.

## What this service is designed to do

- Accept authenticated internal film-job requests.
- Validate up to 120 scenes (120 x 15 seconds = 30 minutes of generated clip duration).
- Create a durable Workflow execution with retries and persisted checkpoints.
- Generate each scene and store the MP4 clip in R2.
- Store a durable manifest and progress after each scene.
- Start a Cloudflare Container with FFmpeg to normalize and join all scenes into one MP4.
- Upload the final MP4 to R2 and mark the job completed.

## Current integration boundary

The Cloudflare service is implemented separately. The existing Render application is not yet connected to it. The next integration change must connect the authenticated/billed Mlimani API to this service, verify that the returned `ownerId` matches the logged-in user, and preserve all existing wallet checks and video prices. Do not expose the internal token or call this API directly from browser code.

## Cloudflare resources and configuration

1. Create an R2 bucket named `mlimani-studio-media` (or change `bucket_name` and `R2_BUCKET_NAME`).
2. Create an R2 API token with Object Read & Write permission scoped only to this bucket.
3. Install dependencies and run `npm test` from this directory.
4. Configure these secrets directly in Cloudflare:
   - `MLIMANI_INTERNAL_TOKEN`: long random shared secret for Render-to-Cloudflare calls.
   - `POLLINATIONS_API_KEY`: video provider API key.
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: credentials used only to create short-lived signed R2 URLs for the FFmpeg Container.
5. Configure the matching `MLIMANI_INTERNAL_TOKEN` in Render later, directly in the Render dashboard.
6. Deploy only after account billing limits and test budget are understood.

The FFmpeg Container uses the `standard-2` instance type (1 vCPU, 6 GiB RAM, 12 GB disk) and can scale to zero after inactivity. This is a starting size; real 30-minute exports must be benchmarked. Container disk is temporary, so all source and final files are stored in R2.

## Job API

- `GET /health`: basic health check.
- `POST /jobs`: authenticated internal request with `ownerId`, `title`, `language`, and `scenes[]`.
- `GET /jobs/:jobId`: authenticated manifest/status response.

Example request body:

```json
{
  "ownerId": "internal-user-id",
  "title": "Mlimani sample film",
  "language": "sw",
  "scenes": [
    { "prompt": "A wide cinematic view of a farm at sunrise", "duration": 15, "aspectRatio": "16:9" }
  ]
}
```

A 30-minute film at 15 seconds per scene needs at least 120 clips. Actual duration depends on the selected clip durations and provider. Video generation fees are separate from Cloudflare infrastructure charges.

## Output

The final file is stored at `film-jobs/<jobId>/final.mp4`. The manifest is stored at `film-jobs/<jobId>/manifest.json` and contains progress, per-scene status, output size, and duration.

The initial FFmpeg pass normalizes all clips to 1280x720 at 30 fps and joins them without audio. Background music, voice-over, subtitles, transitions, and branding are follow-on editing features and are not silently added to the first assembly pass.
