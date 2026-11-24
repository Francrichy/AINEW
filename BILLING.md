# Mlimani Labs Billing and Wallet Notes

## Wallet migration rules
- Wallet tables are created additively with `CREATE TABLE IF NOT EXISTS`.
- Existing balances are not backfilled or reset at startup.
- A service switches to Wallet billing only after a subscription-credit ledger grant exists for that user and service. Older accounts continue using their legacy balance until that service receives a grant.
- Subscription credits are used before purchased credits. Expired subscription balances are ignored. Purchased balances are not reset when a subscription is renewed.
- Every debit is written to `credits_ledger`; the debit operation is transactional and rolls back if the balance is insufficient.

## Credit units
- **Chat:** Wallet amount is denominated in TZS-equivalent usage. Runtime Chat pricing uses the configured markup multiplier and USD/TZS rate.
- **Video:** One credit represents one 5-second generation. A 15-second generation uses three Video credits.
- **Live Talk:** One Mlimani Wallet credit represents one minute. Production avatar sessions are limited to the number of available whole minutes and charged by rounded-up elapsed minutes. Sandbox sessions are not charged. LiveAvatar FULL mode itself uses one provider credit per 30 seconds, so Admin must use the provider's current plan rate when setting the Mlimani price.
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
- Product images are preview-only and are not uploaded to the video provider.
- Ethan and Ngina are prompt guidance in generated ads; consistent identity is not guaranteed. Live Talk production avatars are a separate integration.
- No production paid-generation test is run in CI. CI checks syntax and Wallet billing logic only.
