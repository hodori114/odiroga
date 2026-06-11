# odiroga

K-pop fan travel app — airport→venue routing, one-tap Uber/KakaoT/Google Maps, and fan meetups.
Live: https://odiroga.vercel.app

## Project structure

```
odiroga/
├── public/
│   └── index.html        # Client app (Leaflet map, meetups, GA4) — served at /
├── api/                  # Vercel serverless functions (Node 18+, ESM)
│   ├── tmap-route.js     # TMAP car-route proxy            (Step 2 — stub)
│   ├── tmap-traffic.js   # TMAP traffic/congestion proxy   (Step 2 — stub)
│   ├── seoul-safety.js   # Seoul real-time city-data proxy (Step 6 — stub)
│   └── news-alert.js     # Naver news RSS keyword detector (Step 7 — stub)
├── vercel.json           # Rewrites (/bts, /xia, /admin) + function config
├── package.json
└── README.md
```

## Routes

- `/` — default
- `/bts`, `/xia` — per-artist views (rewritten to `index.html`)
- `/bts?invite=ARMY2026`, `/xia?invite=COCONUT2026` — meetup invite links
- `/admin` — admin approval page (Step 7)
- `/api/*` — serverless functions

## Local development

```bash
npm install -g vercel   # one-time
npm run dev             # = vercel dev, serves public/ + api/ at http://localhost:3000
```

Open http://localhost:3000 , http://localhost:3000/bts , http://localhost:3000/xia .

## Keys

**Server-only (set as Vercel env vars — never commit, never expose to client):**

| Name | Used by |
|------|---------|
| `TMAP_APPKEY` | `api/tmap-route.js`, `api/tmap-traffic.js` |
| `SEOUL_API_KEY_KO` | `api/seoul-safety.js` (Korean) |
| `SEOUL_API_KEY_EN` | `api/seoul-safety.js` (English) |

Set them locally for `vercel dev` via a `.env` file (git-ignored) or `vercel env add`,
and in production via the Vercel dashboard → Project → Settings → Environment Variables.

**Client-safe (embedded directly in `public/index.html`):**
Kakao JavaScript key, Supabase URL + anon key, GA4 measurement ID (`G-5XQZJX2QEK`).

## Implementation roadmap

1. ✅ Project structure transition (single HTML → Vercel project)
2. ✅ TMAP API (real-time route calculation)
3. ✅ Supabase Auth (social login)
4. ✅ Meetup location picker (Kakao Maps)
5. ✅ Live location sharing (Supabase Realtime)
6. ⬜ Seoul real-time city data (auto safety alerts)
7. ⬜ Naver news RSS keyword detection (admin alerts)
