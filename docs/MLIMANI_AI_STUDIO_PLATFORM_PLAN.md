# Mlimani AI Studio — Platform Foundation & Delivery Plan

Status: architecture baseline for phased implementation. This document does not claim these features are already live.

## Product direction
Mlimani AI Studio is a business and creator workspace built around reusable AI agents and virtual presenters:
1. AI Chat — existing Mlimani AI text chat.
2. Create Video — script-to-video with presenter, voice, aspect ratio, preview and download.
3. Live Talk — real-time two-way voice/video with a virtual presenter.
4. AI Interviewer — configurable interview questions, candidate answers, transcript and evidence-based rubric report for human review.
5. Customer Service Agent — answers from an approved company knowledge base, captures enquiries/leads/orders and escalates to a human.
6. Live Presenter — prepares product presentations and marketing videos; later supports approved social publishing.
7. Agent Builder — multiple specialized agents per company (sales, support, HR/interviews, product expert).

Ngina and Ethan are AI characters. Young appearance is the default; mature/older appearance is a separate selection. Age variants need distinct connected visual assets; a label toggle alone does not change the rendered face.

## Product navigation
Overview; AI Chat; Create Video; Live Talk; AI Interviewer; Customer Service; Live Presenter; My Agents; Knowledge Base; Studio Wallet & Usage; Settings / Privacy.

A feature must be labelled Coming soon or Connect provider until its end-to-end workflow is tested. Never show an active badge for a prototype.

## Shared agent foundation
Reuse one server-side agent runtime for Interviewer, Customer Service and Presenter:
- tenant/owner identity; agent name, purpose, language and instructions;
- approved knowledge-base references and source versions;
- tool permissions and explicit approval rules;
- model/provider routing and usage caps;
- conversation/session records; human handover policy and audit events.

Suggested SQLite-compatible entities, subject to schema audit:
- studio_agents: owner_user_id, name, type, description, instructions, language, status, timestamps.
- studio_knowledge_sources: owner_user_id, agent_id, source_type, title, storage_key/url, status, checksum, timestamps.
- studio_sessions: owner_user_id, agent_id, channel, status, started_at, ended_at, consent_json.
- studio_messages: session_id, role, content, created_at.
- studio_jobs: owner_user_id, agent_id, job_type, provider, provider_job_id, status, quote_tzs, reserved_tzs, actual_cost_tzs, output_key, error_code, timestamps.
- studio_usage_events: owner_user_id, agent_id, session_id, job_id, provider, usage_type, provider_cost, retail_cost_tzs, units, created_at.
- studio_wallet_ledger: owner_user_id, reference_type/id, entry_type, amount_tzs, balance_after_tzs, created_at. Ledger entries are append-only.

Before adding tables, inspect existing account, payment and credit logic. Do not duplicate the existing users.credit_used system or silently migrate balances. A separate Studio Wallet requires owner approval of accounting, reconciliation and refund rules.

## Billing and cost protection
- Keep AI Chat billing distinct from video, live sessions, interviews and presenter minutes.
- Existing Mlimani pricing policy is provider cost × at least 4 for chargeable AI usage. Do not hardcode vendor prices or promise final retail prices before contracts and actual metering are confirmed.
- Show a clear estimate and require confirmation before any billable video, interview package or live session.
- Reserve credit before provider calls; settle measured usage; release/refund unused reservation on failure/cancellation. Use idempotency keys to prevent duplicate charges.
- Record provider cost, retail charge, units, currency, provider/model and timestamp for every billable event.
- Enforce per-user, per-agent and global daily/monthly limits on the server. Browser timers are display aids, never billing/security controls.
- Free users only access tightly capped free-provider usage or explicitly budgeted trials. Never route Free users to paid providers without enforced budget and owner approval.
- Video priced by rendered duration/quality; not by AI Chat message allowance.
- Interviewer may be sold per completed interview/package; Customer Service may use monthly base plus usage; Live Talk/Presenter may use metered minutes. Final prices require vendor-cost validation.

## Feature workflows

### Create Video
User selects presenter, appearance, language, voice, script, aspect ratio and duration. Server validates entitlement/content/limits, returns a quote, and waits for confirmation. It then reserves funds, creates an asynchronous job, tracks provider status, settles measured cost on success and releases reservation on failure. Output links are private and retention/deletion is user-controlled.

### Live Talk
Request camera/microphone permission only after Start. Show persistent recording/mic/camera indicators. Create short-lived provider tokens server-side; never expose vendor keys. Enforce maximum duration and budget server-side. Do not record/retain audio or video by default. Transcription/retention requires clear consent and deletion controls. Stop sessions and billing on hang-up, timeout, revoked entitlement or budget exhaustion.

### AI Interviewer
Company configures role, competencies, required questions, optional follow-ups, language and scoring rubric. Candidate sees AI disclosure/privacy notice and chooses supported text/voice mode. Keep core questions consistent and distinguish optional follow-ups. Produce transcript, question-level evidence, rubric scores, strengths, gaps and unanswered items. Never automatically reject candidates or make final hiring decisions; a human reviewer decides. Provide candidate access/deletion process and configurable retention.

### Customer Service Agent
Company uploads approved PDFs/docs, FAQs, product catalogue, prices, delivery/returns policy and/or verifies website sources. Track source status, checksum, date and owner review. Answer only from retrieved approved knowledge; say when data is missing or stale. Never invent price, stock, delivery promises or policies. Capture leads/orders with notice and minimum necessary data. Include human handover, queue/status, contact details and conversation summary. Require approval before placing orders, issuing refunds, changing records or sending external messages.

### Live Presenter and social channels
First generate approved marketing scripts and video assets for manual review. Later add scheduled publishing and DM/comment workflows through official platform APIs and OAuth. Verify professional-account eligibility, permissions, App Review and platform policies per integration. Instagram Live broadcast automation is a separate feasibility gate; Reels publishing or messaging support does not prove Live broadcast support. Keep tokens server-side, encrypt at rest, support disconnect/revoke and log external actions.

## Security, privacy and trust
- Tenant isolation on every query and object lookup.
- Validate file type/size/content; scan uploads; store outside public web root with access-controlled links.
- Treat uploaded documents and website text as untrusted data, not system instructions; defend against prompt injection and data exfiltration.
- Encrypt provider credentials and OAuth tokens; never log secrets or authorization headers.
- Rate limits, abuse detection, moderation and audit logs.
- Explicit permission before voice cloning or using a real person's face/voice; retain consent evidence and allow revocation.
- Disclose AI identity; do not impersonate real employees, candidates, customers or public figures.
- Minimize personal data; define retention by feature; provide deletion/export mechanisms.
- Interview reports are decision support, not automated hiring decisions.

## Provider integration gates
Before production enablement, document and test commercial rights, data retention, availability, Swahili/English recognition and pronunciation, latency, concurrency, browser/WebRTC support, avatar/lip-sync quality, video duration/aspect ratio/watermark/resolution, callbacks, download rights, measured unit prices, minimum commitments and failure billing. Nuance Labs can be evaluated alongside at least one alternative; do not assume Swahili support or commercial suitability without tests.

## Delivery phases
### Phase 0 — Foundation and safety (current)
Keep AI Chat as the only Studio capability represented as available. Keep Live Talk/Create Video labelled prototypes. Define data model, billing invariants, provider adapter contracts and feature flags. Audit /api/chat metering and server-side session enforcement.

### Phase 1 — Studio shell and Agent Builder
Add Studio home/navigation, agent creation/editing, knowledge-source upload/status, usage page and feature flags. Start with private draft agents and no external actions. Add tenant-isolation and upload-security tests before customer rollout.

### Phase 2 — Customer Service and Interviewer pilots
Internal/demo tenant first; include human handover and report review. Text mode before voice mode; no autonomous high-impact decisions. Pilot with explicit retention and cost limits.

### Phase 3 — Video and Live Talk
Select provider only after evaluation; implement quote/reserve/settle/refund and server-side session limits. Release to paid pilot customers before general availability.

### Phase 4 — Social publishing and Live Presenter
Official OAuth integrations, permissions review, scheduling, audit trail and disconnect controls. Live broadcast only after separate documented API/policy feasibility test.

## Production acceptance criteria
A feature is not live until authentication, tenant isolation and entitlements are server-enforced; quote/confirmation/reservation/settlement/refund are tested; failure/timeout/retry/duplicate-webhook cases are tested; privacy/consent/deletion are implemented; language and provider quality are tested end-to-end; monitoring, support ownership and kill switch exist; and UI status accurately reflects capability.

## Immediate engineering checks
1. Verify deployed AI Chat request/response and token handling against the existing login UI.
2. Verify extended-session 4× metering on every /api/chat execution path, including agent/tool calls.
3. Enforce session limits server-side; a browser countdown alone can be bypassed.
4. Add smoke tests for anonymous/free/paid users, daily limits, exhausted credit and extended entitlement.
5. Do not create a new wallet or change customer balances until accounting migration is reviewed.
