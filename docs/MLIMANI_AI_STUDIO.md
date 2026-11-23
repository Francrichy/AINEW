# Mlimani AI Studio — Ngina & Ethan

## Product scope
Mlimani AI Studio adds two original, clearly AI-labelled virtual presenters:
- **Ngina** — feminine-presenting African virtual host.
- **Ethan** — masculine-presenting African virtual host.

Both support two intended experiences:
1. **Live Talk**: real-time two-way voice conversation with an animated photorealistic avatar, camera/microphone permissions, speech recognition, language-aware response generation, speech synthesis, streaming and lip-sync.
2. **Create Video**: script input, avatar selection, Swahili/English voice, aspect ratio (16:9, 9:16, 1:1), asynchronous render job, preview and download.

## Language requirements
- Explicit user choice: Kiswahili or English.
- Do not advertise Swahili support for a provider until end-to-end tests confirm speech recognition, response generation, pronunciation and speech synthesis.
- Preserve a language setting for each session; allow switching between languages.
- A provider fallback must be selected only from tested providers.

## Architecture
- Browser UI is a thin client; never expose vendor API keys.
- Mlimani server owns authentication, plan entitlements, provider routing, metering, rate limits and job status.
- Live session: authenticated server endpoint creates a short-lived provider/LiveKit session token. Browser joins using that temporary token. Server validates plan and available credit before issuing it.
- Video: authenticated request creates a job; server checks plan, estimates/quotes cost, reserves credit, submits provider job, records provider job ID and final cost; settle/refund reservation after completion/failure.
- Provider adapters keep vendor-specific APIs replaceable. Suggested interfaces: createLiveSession(), endLiveSession(), createVideoJob(), getVideoJob().
- Store only required job metadata and usage records. Apply retention/deletion controls to generated media and transcripts.

## Safety, privacy and billing
- Clearly disclose that Ngina and Ethan are AI-generated virtual characters, not real people.
- Obtain explicit camera/microphone permission at the moment Live Talk starts; show recording/transcription indicators.
- Do not record or retain audio/video by default. If retention is later introduced, obtain consent and provide deletion controls.
- Never use a real person's face or voice clone without documented permission.
- Enforce server-side per-user and global cost caps; reserve credit before provider calls; refund failed jobs; stop sessions when limits are reached.
- Free plan: very small trial quota only after provider unit economics are verified. Never route Free users to billable providers without an enforced budget.
- Paid plans: charge from measured provider cost plus the configured Mlimani margin; disclose price/estimated credit before generation.
- No vendor credentials or paid infrastructure should be added without explicit owner approval.

## Provider evaluation gate
Before production integration, compare at least two providers for:
- Photorealistic African avatar quality and natural facial movement.
- Swahili and English speech-to-speech quality, voice quality and pronunciation.
- Live latency, WebRTC/browser support, concurrency and availability.
- Video rendering quality, lip-sync, aspect ratios and job callbacks.
- Pricing per live minute / generated video minute, minimum commitments and regional availability.
- Data processing, retention, consent and commercial-use terms.

Nuance Labs may be evaluated as one candidate, but it must not be treated as the sole provider until Swahili support, availability and pricing are confirmed. A provider's English-only or preview feature must not be represented as full Swahili Live Talk.

## Current implementation status
This branch adds a clearly labelled front-end prototype at /studio.html and a navigation link. It does not start a camera/microphone, call an avatar vendor, generate video, or charge credits. Production APIs and provider credentials are intentionally not configured yet.


## AI Chat and avatar age choices (2026-11-23)
- Added an AI Chat mode in the Studio that calls the existing authenticated `POST /api/chat` endpoint; it uses Mlimani AI's configured model routing rather than pretending a static response is live AI.
- The chat supports Kiswahili and English selection and maintains the current conversation in the browser for the session. The user can download a plain-text transcript or start a fresh conversation.
- Ngina and Ethan remain the selected character identities; users can choose a youthful or mature/older visual presentation. Current portraits are still placeholders until approved avatar image assets are committed.
- Normal AI Chat session duration is 15 minutes; Extended is 60 minutes. Extended is restricted to signed-in paid-plan users and applies a 4x multiplier to metered model usage on the server. The existing base retail markup remains in force, so the extended option costs four times the normal Mlimani AI Chat usage rate. No charge is made just for selecting the option; usage is metered when messages are processed.
- Session transcript download is user-initiated and generated locally as a TXT file; chat history is not automatically uploaded as a downloadable file.
- Live Talk and Create Video remain prototypes and are not represented as operational until real providers, consent flow, language tests and server-side billing are integrated.
