# Mlimani Live Talk Avatar Library

## Featured Mlimani characters

- Ethan and Ngina remain the two featured Mlimani characters at the top of the Studio selection.
- Their production avatar IDs are configured separately with `LIVEAVATAR_ETHAN_AVATAR_ID` and `LIVEAVATAR_NGINA_AVATAR_ID` in the Render environment.
- If a production ID is not configured, the existing sandbox fallback is used. Sandbox output is a provider demo avatar, not the final Mlimani likeness.

## Additional Live Talk avatars

- The Studio requests the authenticated LiveAvatar catalog from the server.
- The server combines provider public avatars and avatars belonging to the connected LiveAvatar account.
- Only catalog entries reported as READY are offered.
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
