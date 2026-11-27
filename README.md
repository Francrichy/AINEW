# Mlimani AI

Jukwaa la AI la Kiswahili (Node + Express + SQLite) linalotumia OpenRouter.

## Endesha kwenye kompyuta
```
npm install
cp .env.example .env   # weka funguo zako
export $(grep -v '^#' .env | xargs) && npm start
```
Fungua http://localhost:3000

## GitHub
```
git init && git add . && git commit -m "Mlimani AI"
git remote add origin https://github.com/JINA/mlimani-ai.git && git push -u origin main
```
(`.env` haipo kwenye git — usiweke funguo kwenye GitHub kamwe.)

## Render (Free plan)
AINEW can run on Render Free for early testing. The current setup uses SQLite on the service filesystem. Render Free web services do not provide a persistent disk, so the database file may be lost when the service restarts, is redeployed, or is replaced. Do not use this Free setup for important production customer records until persistent storage is arranged. The Blueprint is intentionally set to `plan: free` and does not create a paid disk. For reliable production storage, move to a persistent database/storage option after approving its cost or selecting an external free-tier provider with its own limits.

## Kuthibitisha malipo
GET  /api/admin/payments  (header x-admin-key)
POST /api/admin/approve   {"id": 1}  → mpango unawashwa siku 30

## Bei
Mfumo wa wateja wapya ni Pay as You Go: mteja huongeza salio la TZS Wallet na hulipia matumizi halisi tu. Chat hukatwa kwa gharama halisi ya API × markup (kiwango cha chini x4) × USD_TZS. Video, Voice-over, Music, Live Talk na huduma nyingine za Studio zina bei tofauti kwa kila kipimo; bei ya sifuri huzimwa mpaka Admin aweke gharama na bei iliyothibitishwa. Mipango ya mwezi imeachwa kwa akaunti za zamani tu.
Mtumiaji akitumia mkopo wote, gharama yako ya OpenRouter ni 1/3 ya malipo yake.

## Domain (www.mlimani.net)
Render → huduma → Settings → Custom Domains → Add `www.mlimani.net` (au `ai.mlimani.net`).
Kwa msajili wa domain weka CNAME: `www` → `<jina-lako>.onrender.com`. Render huwasha HTTPS yenyewe.

## Bure kwanza
FREE_FIRST=true: kila ujumbe hujaribu modeli ya bure (OpenRouter `:free`) kwanza; ikijaa au ikishindwa, huhamia ya kulipia ya bei nafuu zaidi. Matumizi ya bure hayakati mkopo wa mtumiaji. Angalia logi za Render: "IMETUMIA BURE" / "IMETUMIA KULIPIA".


## Mlimani Labs — Video, Music na Film Studio

Usanifu wa Video Creator, Music Generator na Film Studio (hadi dakika 30), pamoja na usanifu wa malipo ya mobile money na uzalishaji wa scenes, umeandikwa kwenye [docs/MLIMANI_LABS_STUDIO_ARCHITECTURE.md](docs/MLIMANI_LABS_STUDIO_ARCHITECTURE.md). Huu ni usanifu wa utekelezaji; filamu ndefu na utengenezaji wa audio bado vinahitaji provider maalum, storage na worker zilizosanidiwa na kujaribiwa.


## Mlimani Studio cloud storage and AI Music setup
The Studio cloud library uses a private S3-compatible bucket (Cloudflare R2 is the first adapter). Configure these secrets in Render Environment after creating the bucket and scoped API token:
- `R2_ENDPOINT` — Cloudflare account R2 endpoint URL
- `R2_BUCKET` — private bucket name
- `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` — scoped R2 S3 credentials
- `ELEVENLABS_API_KEY` — paid ElevenLabs API key for Music Generator

Configure bucket CORS for the exact Mlimani web origin and `PUT` with request headers `Content-Type`, `x-amz-meta-owner`, `x-amz-meta-project`, and `x-amz-meta-expected-size`; keep the bucket private. Do not paste credentials into GitHub or chat. The Admin must set a positive `studio_music_minute_tzs` retail price only after confirming the provider cost and licensing. It remains disabled at zero by default.

Current cloud upload supports a single direct upload up to 1 GB (not yet resumable). Full timeline editing, FFmpeg export and durable AI film rendering still require the next worker/provider milestones; see the Studio architecture document.
