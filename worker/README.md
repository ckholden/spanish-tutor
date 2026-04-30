# Maestra Lupita — Cloudflare Worker

API proxy for the Spanish Tutor PWA. Holds all API keys server-side, validates Firebase auth tokens, and rate-limits requests.

## First-time setup (5 commands)

```bash
# 1. Install deps
npm install

# 2. Create KV namespace for rate limiting
npx wrangler kv:namespace create RATE_LIMIT
# Copy the printed ID into wrangler.toml under [[kv_namespaces]]
# Also create a preview namespace for local dev:
npx wrangler kv:namespace create RATE_LIMIT --preview

# 3. Fill in wrangler.toml
#    - FIREBASE_PROJECT_ID: your Firebase project ID
#    - FIREBASE_WEB_API_KEY: your Firebase Web API key (from Firebase console → Project settings)
#    - kv_namespaces id and preview_id from step 2

# 4. Set secrets (never goes in wrangler.toml)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY

# 5. Deploy
npx wrangler deploy
```

## Local development

```bash
# Copy .dev.vars.example → .dev.vars and fill in values
cp .dev.vars.example .dev.vars

# Start local Worker (runs on http://localhost:8787)
npm run dev
```

The frontend `api.js` automatically points to `localhost:8787` when running on localhost.

## Routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /health` | none | Returns 200 OK |
| `POST /chat` | required | Stream Maestra Lupita response (Sonnet 4.6) |
| `POST /transcribe` | required | Whisper STT — Phase 2 |
| `POST /extract-vocab` | required | Haiku vocab extraction — Phase 3 |
| `POST /analyze` | required | Haiku post-session analysis — Phase 5 |
| `POST /summarize` | required | Haiku history compression — Phase 5 |
| `POST /compress-memory` | required | Haiku memory digest — Phase 6 |
| `POST /grade-pronunciation` | required | Whisper + Haiku pronunciation grading — Phase 8 |
| `POST /daily-lesson` | required | Haiku daily lesson generation — Phase 9 |
| `DELETE /forget-message` | required | Remove message from session — Phase 10 |

## Firebase RTDB security rules

Deploy these in Firebase Console → Realtime Database → Rules **before going live**:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

## Environment variables

| Name | Where | Description |
|------|-------|-------------|
| `ANTHROPIC_API_KEY` | `wrangler secret put` | Anthropic API key |
| `OPENAI_API_KEY` | `wrangler secret put` | OpenAI API key (for Whisper) |
| `FIREBASE_PROJECT_ID` | `wrangler.toml [vars]` | Firebase project ID |
| `FIREBASE_WEB_API_KEY` | `wrangler.toml [vars]` | Firebase Web API key (public, safe to commit) |
| `CLOUDFLARE_PAGES_ORIGIN` | `wrangler.toml [vars]` | Allowed CORS origin |
