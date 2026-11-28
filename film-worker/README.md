# Mlimani AI Film Worker

Private Render service for Agnes Video 2.5 Flash scene generation, clip polling, MP4 stitching, and optional Cloudflare R2 output storage.

## Important
- This worker uses **only** `agnes-video-2.5-flash` at 720P. It never silently switches to the paid Agnes model or another provider.
- Agnes currently documents Flash as a limited-time promotion; availability, queue limits, and pricing can change. Confirm in the Agnes console before production.
- Each 15-second Studio scene is rendered as two valid Agnes clips (7s + 8s); 5-second scenes are sent as 5 seconds. The final clips are concatenated into one MP4 with FFmpeg.
- R2 is optional. Without R2, output is served from the worker's attached disk. The disk is required for durable output on Render; R2 can be configured later.
- The private service is billable (Render Starter plus disk). Do not create it until the owner approves LIVE infrastructure costs.

## Deploy later
1. In Render, create a Blueprint using `render-film-worker.yaml` in this repository.
2. Use the same Render workspace and Oregon region as AINEW.
3. Set `AGNES_API_KEY` to the existing Agnes key (do not paste it into GitHub or chat).
4. Generate a strong random `MLIMANI_INTERNAL_TOKEN`.
5. Once the private service is created, its internal host should be `mlimani-film-worker:10000`.
6. In the AINEW web service environment, set:
   - `MLIMANI_FILM_WORKER_URL=http://mlimani-film-worker:10000`
   - `MLIMANI_INTERNAL_TOKEN` to the exact same secret.
7. Redeploy AINEW and verify `/health` on the worker from the private network.

## Optional R2 later
Set all four values on the worker only:
- `R2_ENDPOINT`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

R2 stores completed MP4 outputs and the worker returns short-lived signed download URLs. Never expose the R2 secret key to customers.

## Local development
From the repository root:
```sh
cd film-worker
npm install
AGNES_API_KEY=... MLIMANI_INTERNAL_TOKEN=... npm start
```
Use a test key and do not submit real customer work from a local machine.
