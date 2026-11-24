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
Mkopo wa mwezi (TZS) = bei ya mpango. Kila ujumbe unakata gharama halisi x MARKUP(3) x USD_TZS.
Mtumiaji akitumia mkopo wote, gharama yako ya OpenRouter ni 1/3 ya malipo yake.

## Domain (www.mlimani.net)
Render → huduma → Settings → Custom Domains → Add `www.mlimani.net` (au `ai.mlimani.net`).
Kwa msajili wa domain weka CNAME: `www` → `<jina-lako>.onrender.com`. Render huwasha HTTPS yenyewe.

## Bure kwanza
FREE_FIRST=true: kila ujumbe hujaribu modeli ya bure (OpenRouter `:free`) kwanza; ikijaa au ikishindwa, huhamia ya kulipia ya bei nafuu zaidi. Matumizi ya bure hayakati mkopo wa mtumiaji. Angalia logi za Render: "IMETUMIA BURE" / "IMETUMIA KULIPIA".


## Mlimani Labs — Video, Music na Film Studio

Usanifu wa Video Creator, Music Generator na Film Studio (hadi dakika 30), pamoja na usanifu wa malipo ya mobile money na uzalishaji wa scenes, umeandikwa kwenye [docs/MLIMANI_LABS_STUDIO_ARCHITECTURE.md](docs/MLIMANI_LABS_STUDIO_ARCHITECTURE.md). Huu ni usanifu wa utekelezaji; filamu ndefu na utengenezaji wa audio bado vinahitaji provider maalum, storage na worker zilizosanidiwa na kujaribiwa.
