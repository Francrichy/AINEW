# Mlimani Cloudflare Film Orchestrator

This is a separate Cloudflare Worker + Workflows service. It is intentionally isolated from the existing Render-hosted Mlimani AI application.

## What this first stage does

- Accepts authenticated internal film-job requests.
- Validates up to 120 scenes (120 x 15 seconds = 30 minutes of generated clip duration).
- Creates a durable Workflow execution.
- Generates clips one at a time through the configured video provider.
- Stores each MP4 clip and a progress manifest in the R2 bucket.
- Uses Workflow step retries and persisted checkpoints so completed scene objects are not generated again after a retry.
- Exposes an authenticated job-status endpoint.

## Important current limitation

This stage stops at `ready_for_assembly`. It does **not** yet produce the final 30-minute MP4. A separate FFmpeg-capable renderer must be implemented and tested to concatenate clips, normalize resolution/frame rate/audio, add soundtrack/subtitles, and write the final MP4 back to R2. Cloudflare Workers are not being used as an FFmpeg compute server.

The existing Render app is not changed by this subproject. The next integration stage must connect the existing authenticated/billed video API to this service without bypassing wallet checks or changing existing video prices.

## Cloudflare setup (do not do this until code review)

1. Create an R2 bucket named `mlimani-studio-media` (or change `bucket_name` in `wrangler.toml`).
2. Create a Cloudflare API token with R2 Object Read & Write permission scoped only to that bucket. Keep it private.
3. From `cloudflare-film/`, install dependencies and run `npm test`.
4. Set secrets directly in Cloudflare:
   - `MLIMANI_INTERNAL_TOKEN`: long random shared secret for Render-to-Cloudflare calls.
   - `POLLINATIONS_API_KEY`: video provider API key.
5. Deploy only after the Cloudflare account and billing limits are understood.

## Required Render-side environment variables for the later integration

- `MLIMANI_FILM_WORKER_URL`: deployed Worker base URL.
- `MLIMANI_INTERNAL_TOKEN`: same secret configured in Cloudflare.
- Do not expose this token to browser code.

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

A 30-minute film at 15 seconds per scene needs at least 120 clips. Actual duration depends on scene durations and the video provider. Provider generation fees are separate from Cloudflare infrastructure charges.
