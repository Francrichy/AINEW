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

## Render
New → Blueprint → chagua repo (render.yaml inasomwa). Weka OPENROUTER_API_KEY, ADMIN_KEY, PAY_INFO.
Disk ya kudumu inahitaji plan ya kulipia; bila hiyo watumiaji hupotea kila deploy (au tumia Postgres).

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
