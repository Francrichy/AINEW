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
