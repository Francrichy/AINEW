# Mlimani Labs Billing and Wallet Notes

## Wallet migration rules
- Wallet tables are created additively with `CREATE TABLE IF NOT EXISTS`.
- Existing balances are not backfilled or reset at startup.
- A service switches to Wallet billing only after a subscription-credit ledger grant exists for that user and service. Older accounts continue using their legacy balance until that service receives a grant.
- Subscription credits are used before purchased credits. Expired subscription balances are ignored. Purchased balances are not reset when a subscription is renewed.
- Every debit is written to `credits_ledger`; the debit operation is transactional and rolls back if the balance is insufficient.

## Credit units
- **Chat:** Wallet amount is denominated in TZS-equivalent usage. Runtime Chat pricing uses the configured markup multiplier and USD/TZS rate.
- **Video:** Mlimani Studio video and avatar generation are priced by the exact generated duration in seconds. Customer quotes use one bundled total for the selected video and required components (such as voice and lip-sync); supplier cost details are internal Admin information. Provider minimum/maximum durations still apply. Wallet and deposit rules are unchanged by per-second pricing.
- **Live Talk:** One Mlimani Wallet credit represents one minute. Production avatar sessions are limited to the number of available whole minutes and charged by rounded-up elapsed minutes. Sandbox sessions are not charged. LiveAvatar FULL mode itself uses one provider credit per 30 seconds, so Admin must use the provider's current plan rate when setting the Mlimani price. The Live Talk price row is for cost planning; the actual debit is the number of plan minutes.
- **Advertisement:** 15-second product advertisements use the configured `advertisement_15` price when the account has an Advertisement Wallet grant. Accounts without that grant fall back to three Video credits. The 30-second option remains disabled.

## Admin configuration
- Subscription plan fields control the service-specific credits issued when a plan is activated or renewed.
- Admin Pricing values for `markup_multiplier` and `usd_tzs` are loaded at startup and applied when changed in the Admin UI.
- Advertisement pricing defaults are experimental placeholders. Set provider costs and customer prices using measured production costs before commercial launch.
- Live Talk plan credits are minutes, not sessions.

## Payments
- Manual Admin approval and the configured payment webhook both process only pending payment records.
- Approval and plan activation are wrapped in a database transaction to prevent duplicate grants.
- A payment gateway is not enabled by this change; the existing manual confirmation process remains in place.

## Studio limitations
- The current product-ad workflow drafts a script using Chat, requires the customer to approve it, and then generates a 5- or 15-second video.
- The 15-second model is configured as `bytedance/seedance-2.0` by default; `VIDEO_MODEL_15S` can override it. If the provider account does not allow that model or duration, the job fails without consuming credits.
- 30-second generation is not enabled because the current verified model path does not guarantee a single 30-second output.
- Product images are uploaded only when the customer starts a 15-second product ad. They are kept in a short-lived in-memory reference store, served through an unguessable HTTPS URL for the provider to fetch, then deleted after generation or after 10 minutes. The customer is informed before generation.
- Ethan and Ngina are prompt guidance in generated ads; consistent identity is not guaranteed. Live Talk production avatars are a separate integration.
- No production paid-generation test is run in CI. CI checks syntax and Wallet billing logic only.


## PAYG Cash Wallet
- Customers no longer purchase monthly Chat or Video subscriptions.
- New top-ups are recorded as pending payments and are credited only after manual Admin confirmation.
- Cash top-ups are stored in the existing Mlimani AI SQLite Wallet tables under the `cash` service and `purchased` bucket. No old Chat, Video, Live Talk or Advertisement balances are deleted or converted.
- AI Chat and the developer API debit actual provider token usage in TZS using the Admin markup (minimum ×4) and USD/TZS rate.
- Mlimani Studio fal.ai video uses the Admin-configured `fal_video_second_tzs` rate per second; Talking Avatar combines per-second video generation and per-second lip-sync into one customer quote, with voice charged separately where generated. Other legacy advertisement routes retain their existing pricing until migrated.
- Live Talk uses the Admin-configured `live_talk_minute_tzs` rate and bills rounded-up elapsed minutes.
- Video, advertisement and Live Talk PAYG are blocked while their Admin rate is zero. Set and test rates before commercial use.
- New cash top-ups do not expire. Old subscription credits retain their existing expiry rules.
- The old monthly plans are no longer offered through the customer payment endpoint. Historical pending plan payments remain reviewable.

## Mlimani Fleet connector
- Fleet is connected through its tenant-scoped MCP endpoint using a short-lived, 7-day token generated by the Fleet owner at `/ai-connect.html`.
- Mlimani AI stores the token encrypted using `ENCRYPTION_KEY`; it does not store Fleet passwords.
- The Fleet token is restricted to MCP and cannot access normal Fleet REST routes or approve/reject owner actions.
- MCP read tools remain scoped to the signed-in Fleet company and its module permissions. AI write proposals require separate approval by the company owner inside Fleet.
- No Mlimani Fleet PostgreSQL data or customer records are migrated or rewritten by the Mlimani AI connector.
