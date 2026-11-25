# Mlimani Live Talk Avatar Library

## Featured Mlimani characters

- Ethan and Ngina remain the two featured Mlimani characters at the top of the Studio selection.
- Their production avatar IDs are configured separately with `LIVEAVATAR_ETHAN_AVATAR_ID` and `LIVEAVATAR_NGINA_AVATAR_ID` in the Render environment.
- Live Talk defaults to Tanzanian Swahili (`sw`); English (`en`) is available as the second language.
- The language is selected before choosing Ethan or Ngina, and is sent to the server when the session is created.

## Additional Live Talk avatars

- The Studio requests the authenticated LiveAvatar catalog from the server.
- The server combines provider public avatars and avatars belonging to the connected LiveAvatar account.
- Only catalog entries reported as ACTIVE or READY are offered.
- A selected avatar ID is sent to the server; the server checks that it is still present and READY in the account catalog before creating a session.
- The LiveAvatar API key stays on the server. It must never be sent to browser code.
- Production Live Talk sessions use the existing Mlimani minute-pricing and wallet checks.

## Custom avatars and consent

Custom avatar creation is a separate provider workflow and is not created by the catalog-selection feature. LiveAvatar currently documents custom creation from a single image or from a continuous video of at least two minutes. The provider requires the consent process appropriate to the account plan. Use only a person's likeness with their explicit permission and retain evidence of that permission. Do not upload a customer's photo/video until the provider's current API workflow, account eligibility, consent steps, storage and deletion rules have been reviewed.

Official provider guidance:
- https://help.heygen.com/en/articles/12758866-liveavatar-faq
- https://help.heygen.com/en/articles/9612935-liveavatar-custom-liveavatar-creation-guide
- https://docs.liveavatar.com/

## Configuration and rollout

Required existing server secret:
- `LIVEAVATAR_API_KEY` (set directly in Render Environment; never commit it).

Optional production character IDs:
- `LIVEAVATAR_ETHAN_AVATAR_ID`
- `LIVEAVATAR_NGINA_AVATAR_ID`

No new paid Cloudflare resources are required for this feature. Provider Live Talk credits and any custom-avatar subscription or slot are separate costs. Keep production pricing disabled until the provider account, avatar IDs, voices, Kiswahili quality and wallet billing have been tested end to end.

## Tanzanian Swahili-first Live Talk

- The Studio language selector defaults to `sw` (Tanzanian Swahili) and offers `en` (English).
- The Swahili context instructs the assistant to use natural standard Tanzanian Swahili, an East African accent, clear numbers and names, and avoid unnecessary code-switching.
- Voice selection prefers a voice explicitly tagged Swahili. A multilingual voice may be used as a fallback with a visible warning so Admin can test pronunciation.
- An English-only voice is never silently selected for a Swahili session. If the connected LiveAvatar account has no Swahili or multilingual voice, the session is stopped with a clear setup message.
- HeyGen documents Swahili (Kenya and Tanzania) among supported platform voice languages. Actual LiveAvatar account voice availability and pronunciation must still be tested before production.

## Real-human Live Talk requirement

Live Talk exposes provider public human-presenter avatars. Private/custom avatars are hidden unless their IDs are explicitly approved by Admin through `LIVEAVATAR_REAL_HUMAN_AVATAR_IDS` (comma-separated). Ethan and Ngina each require their own approved production ID in `LIVEAVATAR_ETHAN_AVATAR_ID` and `LIVEAVATAR_NGINA_AVATAR_ID`. Live Talk no longer silently falls back to a sandbox demo character if these IDs are missing.

## AI Video avatar quality pricing

The Video Creator offers three styles, priced separately per five seconds:

- `video_realistic_5s_tzs`: photorealistic human actors, highest tier
- `video_stylized_5s_tzs`: semi-realistic/stylized characters, middle tier
- `video_cartoon_5s_tzs`: animated cartoon characters, lower tier

All three prices are Admin-controlled in Billing > Pricing. Each defaults to zero, which keeps that tier disabled until a price is approved. The Studio requests an estimate before generation, shows the total and wallet balance, and asks for confirmation. The server checks the expected estimate against the current Admin price and only debits the cash wallet after the provider returns a valid video. If generation fails, no debit is made.

These quality tiers apply to AI Video Creator clips (5 or 15 seconds). They do not change the separate Film Studio per-minute price. Existing legacy video credits are not used by this new tiered cash-wallet flow; customers need sufficient TZS Wallet balance for the selected tier.
