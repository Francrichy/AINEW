# Mlimani Labs — Video, Music & Film Studio Architecture

Status: implementation blueprint; provider-backed rendering is not enabled yet.

## Product objective
Build a Swahili-first creative studio for Tanzania and East Africa. The product must work well on mobile screens and low-bandwidth connections, support Swahili and English prompts/voice/subtitles, price creative generation separately from chat, and accept local mobile-money payments.

## Product areas
1. **Video Creator** — short adverts, product promos, explainers, social clips, training and event videos. Keep the current 5s/15s provider path isolated as the short-clip adapter.
2. **Music Generator** — song concept, lyrics, structure, genre/mood, language, vocal direction, instrumental brief, and generated audio through a licensed audio provider. Lyrics-only must remain available even when audio generation is not configured.
3. **Film Studio** — script, synopsis, characters, locations, storyboard, shot list, scene generation, voice/dialogue, music, subtitles, review and final assembly. User selects duration up to **30 minutes (1,800 seconds)**.

## 30-minute film production model
Do not send one 30-minute prompt to a short-clip API. Treat a film as a project containing scenes and shots:
- Project duration is validated from 1 to 1,800 seconds.
- AI drafts a script and scene plan. The user approves the script before paid rendering begins.
- Break the timeline into scenes; each scene contains one or more shots within the selected provider's supported clip duration.
- Maintain a project bible: character descriptions, wardrobe, locations, visual style, aspect ratio, language, voice identity, and continuity notes. Reuse approved reference images/character assets where the provider supports them.
- Generate scene video and audio assets asynchronously; retry failed shots with bounded attempts.
- Assemble clips in timeline order with transitions, dialogue, music mix, subtitles, title/credits and end card using an FFmpeg worker.
- Save preview versions and final master; permit pause/resume and scene-level regeneration.
- Show progress by completed/total shots and estimated remaining work. Never tell the user a film is complete until the final render is stored and verified.

A 30-minute project may require dozens or hundreds of generated clips. Actual scene count depends on shot length and provider limits. Cost and delivery time must be estimated before the user confirms rendering.

## Job and storage architecture
Use durable database records, not in-memory Maps, for production jobs:
- `creative_projects`: owner, type (video/music/film), title, language, status, duration_seconds, aspect_ratio, script_json, style_json, estimated_cost, reserved_amount, created_at, updated_at.
- `creative_scenes`: project_id, scene_number, duration_seconds, script, shot_list_json, continuity_json, status, attempts.
- `creative_assets`: project_id, scene_id, asset_type (image/video/audio/subtitle/final), storage_key, provider, provider_job_id, mime_type, duration_seconds, status, metadata_json.
- `creative_jobs`: project_id, scene_id, job_type, status, attempts, next_run_at, locked_at, error_code, provider_job_id.
- `creative_ledger`: user_id, project_id, entry_type (reserve/charge/refund), amount_minor, currency, reference, created_at.

Workers claim queued jobs with a lease, call the selected provider, poll provider status, store outputs in S3-compatible object storage, and update progress. Use idempotency keys for provider requests and payment callbacks. Keep signed download URLs short-lived. Do not store generated large media in SQLite or process memory.

Recommended service separation:
- Web/API: project creation, script approval, job status, wallet and callbacks.
- Queue/worker: provider calls, retries, FFmpeg assembly and cleanup.
- Object storage: source clips, audio, thumbnails, previews and final exports.
- Database: durable project state and billing ledger.
- Optional Redis/Valkey: queue coordination and short-lived locks, not the only record of job state.

## Provider adapter contracts
Create provider-neutral interfaces so providers can be changed without rewriting the studio:
- Video: `createVideo({prompt, durationSeconds, aspectRatio, referenceAssets, language})`, `getVideoJob(id)`, `downloadVideo(id)`.
- Music/audio: `createMusic({lyrics, language, genre, mood, durationSeconds, vocalDirection})`, `getMusicJob(id)`, `downloadAudio(id)`.
- Speech: `createSpeech({text, language, voiceId, format})`.
- Rendering: `assembleFilm({orderedAssets, timeline, subtitles, audioMix, outputProfile})`.

Every adapter must declare supported durations, languages, regions, content rules, unit costs, licensing and data-retention terms. Never expose provider keys to the browser. Do not enable paid generation until an actual provider account/key, terms, cost table and successful test are configured.

## Swahili and East African experience
- Default interface and assistant instructions: Kiswahili sanifu; allow English and mixed Swahili/English.
- Project language choices: Kiswahili, English, and provider-supported regional languages. Do not promise a voice or dialect until tested.
- Captions/subtitles editable before final render; support SRT/VTT export.
- Mobile-first wizard: idea → script → characters/style → scenes → cost estimate → approval/payment → production → preview → export.
- Low-bandwidth mode: thumbnails, compressed previews, resumable uploads/downloads and background processing.
- Display prices in TZS by default. Add KES, UGX and RWF only when the wallet and payment rails support them.

## Mobile-money and billing
Use a payment adapter, not a direct dependency between the studio and one provider:
- Tanzania launch candidates: merchant integrations for M-Pesa, Airtel Money, Mixx by Yas and HaloPesa, through an approved aggregator or direct merchant contracts.
- East Africa expansion: add country-specific adapters only after merchant onboarding and settlement testing.
- Existing manual bank/mobile payment instructions can remain as a fallback, but automated crediting must happen only after a verified server-to-server callback or admin reconciliation.
- Store money as integer minor units with currency codes; verify callback signatures, amount, currency, merchant reference and idempotency.
- Before rendering, calculate an estimate and reserve wallet funds. Charge actual completed work; refund unused reserve and failed provider jobs. Never debit twice on retry.
- Separate Chat, Live Talk, Video, Music and Film balances/ledger entries. Show estimated cost and require explicit confirmation before paid generation.
- Admin controls: provider enable/disable, per-second/per-clip rates, markup, currency, max project duration, daily limits, refunds and audit log.

## API surface (proposed)
- `POST /api/labs/projects` — create project and validate duration.
- `POST /api/labs/projects/:id/script` — generate or revise script/scene plan (chat model; clearly separated from media rendering).
- `POST /api/labs/projects/:id/approve-script` — lock approved version.
- `POST /api/labs/projects/:id/estimate` — estimate scene count, provider cost and user price.
- `POST /api/labs/projects/:id/render` — reserve credits and enqueue production after user confirmation.
- `GET /api/labs/projects/:id` — status, scenes, progress and estimate.
- `POST /api/labs/projects/:id/scenes/:sceneId/retry` — regenerate a failed/selected scene with a fresh estimate if cost changes.
- `GET /api/labs/assets/:id/download` — authenticated short-lived download.
- `POST /api/payments/:provider/webhook` — verified, idempotent payment callback.

## Security, safety and rights
- Keep API credentials in Render environment variables; never commit keys.
- Enforce per-user ownership on every project, scene and asset query.
- Validate prompt sizes, duration, MIME type and upload size. Rate-limit generation and webhook endpoints.
- Require users to confirm rights to uploaded reference images, voices, scripts and music. Do not clone a real person's voice or likeness without authorization.
- Apply provider content policies and maintain abuse reporting, deletion and retention controls.
- Do not use a volatile in-memory job Map for paid work.

## Rollout gates
1. **Foundation**: fix and test Free-plan plugin orchestration; keep billing safe.
2. **Planning MVP**: project/script/scene planning and estimates; no paid media generation until a provider is selected.
3. **Short-video provider**: retain current short clips, then introduce durable jobs and object storage.
4. **Music provider**: enable audio generation after provider licensing, Swahili quality and cost tests.
5. **Film pipeline**: scene generation, queue workers, FFmpeg assembly, subtitle and continuity QA; test 1, 5, 15 and 30-minute projects.
6. **Mobile money**: merchant onboarding, signed callbacks, reconciliation and wallet ledger tests before public launch.

## Current implementation facts
- Current video endpoint only accepts 5-second or 15-second clips and uses in-memory job/reference maps.
- Current LiveAvatar integration is for interactive live sessions, not finished film rendering.
- No production music-generation adapter or durable 30-minute film pipeline is confirmed in the current code.
- Therefore this document is a design and rollout plan, not a claim that 30-minute films or generated songs are live today.


## Planning MVP implementation (November 2026)
- Added `public/production-studio.html`, linked from the Music Generator and Film Studio cards on `public/studio.html`.
- Music Generator uses the authenticated Mlimani chat endpoint to draft original lyrics, song structure, suggested tempo/BPM, and instrumentation from the user's brief.
- Film Studio uses the authenticated Mlimani chat endpoint to draft a logline, synopsis, characters, locations, timed scene breakdown, opening-scene script, and production notes for a selected duration from 5 to 30 minutes.
- Drafts can be edited, downloaded as text, and saved in the current browser's local storage.
- This is a planning and writing MVP only. It does not generate audio, singing voices, video clips, or completed films. Local browser storage is not cloud project storage and drafts do not sync between devices.
- No new provider credentials, paid media provider, database tables, payment flow, or Render service changes are required for this planning MVP.


## Implemented Studio milestone — November 24, 2026
- PR #58 merged the mobile-first Studio workspace to `main`: browser camera recording up to 30 minutes, local video preview, file selection/preview, and download.
- The browser recording flow is device-local. It does **not** upload, back up, edit, or sync source media to Mlimani cloud. Long recordings use browser storage/memory; 720p is recommended on phones.
- AI Video still uses the existing provider endpoint and remains limited to 5s/15s. The old in-memory job map is not a durable film-rendering queue.
- Added a server-side ElevenLabs Music API adapter at `POST /api/studio/music` on the follow-up branch. It uses model `music_v2_5`, MP3 output, and a separate Studio cash-wallet price setting `studio_music_minute_tzs`. The browser never receives the provider key. It is not enabled until an admin sets a positive customer price and Render has `ELEVENLABS_API_KEY`.
- Music endpoint currently caps a single generation request at 180 seconds for the first release; the upstream API supports longer output, but long-running requests need durable jobs and storage before safely exposing longer tracks.
- New Admin pricing keys are introduced with zero customer price by default: `studio_music_minute_tzs`, `studio_voice_minute_tzs`, and `studio_video_second_tzs`. Zero means disabled; no new Studio charge is silently activated.
- Existing chat pricing and wallet are not reused as Studio product pricing. The Music adapter charges the cash wallet under the separate service description after successful provider response. A failed provider request does not debit the wallet.

## Provider and infrastructure decisions to complete before production
- **Music**: ElevenLabs Music API documents `POST /v1/music`, model IDs including `music_v2_5`, output audio, and music durations from 3 seconds to 10 minutes. The API requires a paid ElevenLabs subscription. Current public API pricing lists approximately USD 0.15 per generated minute; confirm actual account tier and licensing before setting retail prices. Music commercial rights vary by subscription tier; film/TV/game rights require Enterprise terms. Sources: https://elevenlabs.io/docs/api-reference/music/compose and https://elevenlabs.io/pricing/api.
- **Video**: provider choice must be confirmed before film pricing. Public API prices are usage-based and vary significantly by model/resolution/audio. For illustration, fal lists Kling 2.5 Turbo Pro at USD 0.07/second and Seedance 2.0 at USD 0.3034/second for 720p with audio. A theoretical 30-minute render at those rates would be USD 126 or USD 546.12 respectively for output seconds alone, before retries, storage, audio, assembly and markup. These are illustrations, not a retail quote or a promise that one provider can generate a continuous 30-minute clip. Source: https://fal.ai/explore/text-to-video-apis.
- **Object storage**: Cloudflare R2 is a candidate for user footage, music and exports. Its public standard storage price is USD 0.015/GB-month with 10 GB-month free tier and no egress fees; request charges also apply. Bucket, API token, CORS, lifecycle and retention policy still need owner setup. Source: https://developers.cloudflare.com/r2/pricing/.
- **Durable film pipeline**: needs a persistent project/job database, object storage, a queue (e.g. Render Key Value/Valkey), a paid Render background worker, FFmpeg, retries/checkpoints and a billing reservation/refund ledger. Do not add paid Render resources or change the current Render plan without explicit cost approval.
- **Customer pricing**: Admin must set provider cost, retail price, FX rate, markup, generation limits and cancellation/refund rules after a successful provider test. No placeholder zero price may be bypassed.

## Remaining work before calling Mlimani Studio production-ready
1. Provision and configure R2 or another S3-compatible object store, then implement authenticated resumable uploads, per-user project library, signed download URLs and deletion/retention.
2. Add a durable relational project/job store and a queue/worker; the current AINEW app uses SQLite and an ephemeral Render filesystem by default. Do not reuse or alter Mlimani Fleet's PostgreSQL.
3. Add FFmpeg-based video editing/export: trim, split, combine, overlays, title cards, transitions, audio mixing, subtitles and final MP4 render.
4. Implement provider-neutral video adapters and durable polling/callbacks. Generate 5–30 second scenes, then assemble films up to 30 minutes only after the user approves a cost estimate.
5. Add production TTS/voice-over and dubbing with a tested Swahili voice, user consent for voice cloning, and separate Studio voice pricing.
6. Add Studio project/asset management, script approval, scene regeneration, progress, retry/resume, exports, and audit history.
7. Run automated tests and provider acceptance tests on Render. Only after successful tests should the branch be merged and the deployment authorized.


## Cloud media library implementation milestone — November 24, 2026
- Added an S3-compatible private object-storage adapter using Cloudflare R2 configuration. Media objects are isolated by authenticated user ID; project metadata is stored as private JSON objects in the same bucket.
- Added authenticated endpoints for storage status, presigned uploads, upload completion verification, project listing, temporary signed downloads, and project deletion.
- Uploads are sent directly from the browser to R2; the Mlimani API does not proxy large video files. The initial single-request upload limit is 1 GB. Multipart/resumable upload is still required for unreliable networks or larger recordings.
- The server verifies the uploaded object's owner/project metadata before creating the project record. Download URLs expire after 10 minutes.
- Required Render environment values are declared in `render.yaml`: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. They must be filled by the account owner after creating a private R2 bucket and scoped API token.
- Configure the R2 bucket CORS policy to allow the exact Mlimani site origin (for example `https://www.mlimani.net`), method `PUT`, request header `Content-Type`, and expose only the response headers needed by browser uploads. Do not make the bucket public.
- The browser Studio page now has a cloud library list with download and delete controls, plus actions to upload recorded or selected videos.
- R2 free-tier pricing currently includes 10 GB-month standard storage and 1 million Class A / 10 million Class B requests; standard storage above included usage is USD 0.015/GB-month. Confirm current terms and request volumes. Source: https://developers.cloudflare.com/r2/pricing/.

## Remaining production gates (revised)
1. Configure and test R2 credentials/CORS in Render; test upload, download, ownership isolation, deletion, and 30-minute recordings on real phones.
2. Add multipart/resumable upload, thumbnails, preview transcoding, retention controls, and cloud project metadata versioning.
3. Implement timeline editing and FFmpeg export; no editing engine is shipped in this milestone.
4. Add durable film jobs, queue and worker, provider polling/retries, cost reservation/refunds and scene assembly. Do not attempt a 30-minute film as one synchronous web request.
5. Select and configure a video provider for long-form scene generation, then validate unit costs and provider terms before exposing 30-minute AI films.
6. Add tested Swahili voice-over/TTS, dubbing and licensed avatar/voice consent workflows.
7. Run dependency install, automated tests, security checks and provider acceptance tests before production rollout.
