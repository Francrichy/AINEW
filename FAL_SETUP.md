# fal.ai setup for Mlimani

Mlimani uses fal.ai's server-side Queue API. The API key is never sent to the browser. Long-running jobs are submitted to `https://queue.fal.run` and checked through the job-status endpoint.

## Render Environment

Set `FAL_API_KEY` as a secret in Render. Do not put the key in GitHub or in browser code. The first launch uses one fal.ai account and one key for all selected models.

## First launch models

| Mlimani feature | fal.ai model ID | Required inputs | Default output |
|---|---|---|---|
| Video Creator Lite | `minimax/h3-max/image-to-video` | prompt; optional image and soundtrack | 768P, 5–15 second clips |
| Talking Avatar | `minimax/h3-max/lip-sync/image-to-video` | image URL and audio URL | 768P; lip-sync follows audio length |
| Full Motion Avatar | `minimax/h3-max/reference-to-video` | prompt and reference image; optional soundtrack | 768P, motion and generated scene audio |

Mlimani offers 1080P as Premium. The model endpoint's current price is synced from fal.ai by Admin; do not hardcode prices. H3 Max Lip Sync currently has a 1.2× multiplier for output longer than 15 seconds, which the Mlimani estimate and charge calculation apply. The Talking Avatar supports either uploaded audio or script-to-speech through `fal-ai/elevenlabs/tts/eleven-v3`, followed by H3 Max Lip Sync. Both stages use the same fal.ai account and key. Voice and lip-sync charges are shown separately and combined in the initial estimate; if the generated speech length changes the lip-sync estimate, the customer is asked before the second stage is charged.

Image/audio uploads use the customer's private Mlimani Cloud project space. The server creates a short-lived signed URL for fal.ai; the URL is issued only to the authenticated owner and expires after six hours.

For each task, configure both a model ID and an input-template JSON string:

| Task | Model variable | Input template variable | Admin price key |
|---|---|---|---|
| Image | `FAL_IMAGE_MODEL` | `FAL_IMAGE_INPUT_TEMPLATE` | `fal_image_tzs` |
| Video | `FAL_VIDEO_MODEL` | `FAL_VIDEO_INPUT_TEMPLATE` | `fal_video_5s_tzs` |
| Music | `FAL_MUSIC_MODEL` | `FAL_MUSIC_INPUT_TEMPLATE` | `fal_music_minute_tzs` |
| Voice / TTS | `FAL_VOICE_MODEL` | `FAL_VOICE_INPUT_TEMPLATE` | `fal_voice_1000_chars_tzs` |
| Speech to text | `FAL_SPEECH_MODEL` | `FAL_SPEECH_INPUT_TEMPLATE` | `fal_speech_minute_tzs` |
| Animation | `FAL_ANIMATION_MODEL` | `FAL_ANIMATION_INPUT_TEMPLATE` | `fal_animation_tzs` |
| Motion | `FAL_MOTION_MODEL` | `FAL_MOTION_INPUT_TEMPLATE` | `fal_motion_second_tzs` |
| Avatar video / talking photo | `FAL_AVATAR_VIDEO_MODEL` | `FAL_AVATAR_VIDEO_INPUT_TEMPLATE` | `fal_avatar_video_second_tzs` |

Use the exact model ID from the chosen model's fal.ai API page. Each model has its own input schema. The template must be valid JSON and must match that model's documented schema.

## Supported template placeholders

- `{{prompt}}` – user prompt or text
- `{{durationSeconds}}` – requested duration in seconds
- `{{aspectRatio}}` – selected aspect ratio
- `{{audioUrl}}` – HTTPS audio URL (speech recognition or audio input)
- `{{imageUrl}}` – HTTPS image URL
- `{{voiceId}}` – voice ID
- `{{language}}` – `sw` or `en`
- `{{resolution}}` – `768P`, `1080P`, or `480P`

Example template for fal.ai's documented Speech-to-Text endpoint:

```json
{
  "audio_url": "{{audioUrl}}"
}
```

Example template for a model whose API schema accepts a prompt:

```json
{
  "prompt": "{{prompt}}"
}
```

Do not copy either example blindly to a different model; use that model's API schema.

## Admin pricing

The adapter creates the listed pricing rows at TZS 0. In Admin → Pricing, set both provider cost and customer price only after checking the selected model's current fal.ai pricing. A task remains disabled while its customer price is zero. The adapter reserves the customer's Wallet amount before submitting the job and refunds automatically if submission or generation fails.

## API routes

- `GET /api/admin/fal/status` – Admin-only readiness for each task (key values are never returned).
- `GET /api/studio/fal/:task/estimate` – authenticated estimate.
- `POST /api/studio/fal/:task/jobs` – authenticated queue submission. Body fields: `prompt`, `durationSeconds`, `aspectRatio`, `audioUrl`, `imageUrl`, `voiceId`, `language`, `expectedChargeTzs`.
- `GET /api/studio/fal/jobs/:id` – authenticated status and result.

Task names: `image`, `video`, `music`, `voice`, `speech`, `animation`, `motion`, `avatar_video`.

Long-running jobs use fal.ai's Queue API. Mlimani stores the job owner, task, model, request ID and billing status; users can only view their own jobs.
