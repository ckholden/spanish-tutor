# Maestra Lupita — Spanish Tutor PWA

A personal Mexican Spanish tutor PWA for nursing students. Voice-first conversation, adaptive learning, and a dedicated medical Spanish module.

**Live:**
- 🌐 [maestra-lupita.pages.dev](https://maestra-lupita.pages.dev)
- 🌐 [holdenportal.com/spanish](https://holdenportal.com/spanish)

## Stack

- Frontend: Vanilla HTML/ES modules, Cloudflare Pages
- Backend: Cloudflare Worker (proxies Anthropic + Whisper, validates Firebase auth, rate-limits via KV)
- Auth: Firebase email/password
- Database: Firebase Realtime Database (per-UID security rules)
- Tutor LLM: Claude Sonnet 4.6
- Helper LLM: Claude Haiku 4.5
- Speech-to-text: OpenAI Whisper (`whisper-1`, language=es)
- Text-to-speech: Browser SpeechSynthesis (es-MX preferred)

## Repo layout

```
/spanish/   Frontend (deployed to Cloudflare Pages + holdenportal.com/spanish)
/worker/    Cloudflare Worker (deployed to maestra-lupita-worker.workers.dev)
/database.rules.json  Firebase RTDB security rules
```

## Local dev

```bash
# Worker
cd worker
npm install
cp .dev.vars.example .dev.vars   # fill in API keys
npx wrangler dev

# Frontend (in another terminal)
cd spanish
npx serve . --listen 3000
```

Then open http://localhost:3000.

## Deployment

```bash
# Worker
cd worker && npx wrangler deploy

# Frontend (manual)
npx wrangler pages deploy spanish --project-name=maestra-lupita

# Firebase rules
firebase deploy --only database
```

## Required secrets

Set in `worker/.dev.vars` (local) and via `wrangler secret put` (production):
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`

Set in `wrangler.toml` (public, safe to commit):
- `FIREBASE_PROJECT_ID`
- `FIREBASE_WEB_API_KEY`
- `CLOUDFLARE_PAGES_ORIGIN` (comma-separated allowlist)

## License

Personal project. All rights reserved.
