# Maestra Lupita — Personal Mexican Spanish Tutor PWA

A voice-first Spanish tutor for nursing students. Conversational practice with Maestra Lupita, structured role-plays, medical Spanish for clinical work, adaptive learning that targets your weak areas, and SRS flashcards with pronunciation grading.

## Live

- 🌐 **[holdenportal.com/spanish](https://holdenportal.com/spanish)** — production (GitHub Pages)
- 🌐 **[maestra-lupita.pages.dev](https://maestra-lupita.pages.dev)** — Cloudflare Pages (auto-deployed from main)
- 🛠️ **[Worker API](https://maestra-lupita-worker.christiankholden.workers.dev/health)** — backend

## Repos

- 📦 [`ckholden/spanish-tutor`](https://github.com/ckholden/spanish-tutor) — source of truth (this repo)
- 🌐 [`ckholden/Holden-nerd-portal`](https://github.com/ckholden/Holden-nerd-portal) — `/spanish/` is synced here for holdenportal.com

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML + ES modules + CSS (no build step) |
| Backend | Cloudflare Worker (proxies LLMs, Firebase auth validation, KV rate limit) |
| Auth | Firebase email/password (IndexedDB persistence) |
| Database | Firebase Realtime Database (per-UID security rules) |
| Tutor LLM | Claude Sonnet 4.6 |
| Helper LLM | Claude Haiku 4.5 (analysis, vocab extraction, pronunciation grading, memory compression) |
| STT | OpenAI Whisper (`whisper-1`, language=es) |
| TTS | Browser SpeechSynthesis (es-MX preferred) |
| PWA | manifest + service-worker (cache-first shell, network-first API) |

## Phases shipped

| # | Phase | Status |
|---|---|---|
| 1 | Worker + Firebase Auth + free chat (streamed) | ✅ |
| 2 | Voice in/out (Whisper + TTS) + Conversation Mode | ✅ |
| 3 | Vocab extraction + flashcards + SRS-lite | ✅ |
| 4 | Scenarios (10 seeded role-plays) | ✅ |
| 5 | Adaptive learning engine (post-session Haiku → learner model) | ✅ |
| 6 | Memory digest (cross-session continuity) | ✅ |
| 7 | Medical Spanish module (10 topics + cultural notes) | ✅ |
| 8 | Pronunciation grading (Whisper + Haiku) | ✅ |
| 9 | PWA install + cross-device sync + history | ✅ |
| 10 | Polish | ⏳ ongoing |

## Repo layout

```
/spanish/                        Frontend (Cloudflare Pages root + holdenportal.com/spanish)
  index.html
  manifest.webmanifest           PWA manifest
  service-worker.js              Cache-first shell + offline fallback
  /css/styles.css
  /js/
    app.js                       Orchestrator: auth gate, tabs, modes, history, conversation loop
    auth.js                      Firebase auth wrapper + IndexedDB persistence
    api.js                       Worker fetch wrappers (chat streaming, analyze, summarize, vocab)
    chat.js                      ChatSession class + message rendering + cloud sync
    voice.js                     MediaRecorder, iOS AudioContext unlock, TTS, silence detection
    vocab.js                     SRS-lite, flashcards, pronunciation drill UI
    scenarios.js                 Scenario picker + opening kickoff
    medical.js                   Medical topic picker + cultural notes banner
    firebase-config.js           Firebase SDK config (public, safe to commit)
  /data/
    scenarios.json               10 real-world scenarios
    medical-topics.json          10 medical Spanish topics
  /icons/                        PWA install icons (192, 512, apple-touch, favicon)

/worker/                         Cloudflare Worker
  /src/
    index.js                     All routes: /chat, /transcribe, /analyze, /summarize,
                                 /extract-vocab, /grade-pronunciation, /compress-memory, /health
    system-prompts.js            BASE_SYSTEM_PROMPT (Maestra Lupita persona) + scenario/medical
                                 templates + analysis/grading/compression prompts
  wrangler.toml                  Public config (project ID, KV bindings, CORS allowlist)

/.github/workflows/
  deploy.yml                     ✅ active — auto-deploys spanish/ to Cloudflare Pages on push
  deploy-worker.yml.disabled     ⏳ needs Cloudflare token with Workers permission
  sync-portal.yml.disabled       ⏳ needs PORTAL_PUSH_TOKEN secret

/database.rules.json             Firebase RTDB per-UID rules
/.firebaserc                     Active Firebase project
```

## Worker routes

| Route | Method | Model | Purpose |
|---|---|---|---|
| `/health` | GET | — | Returns `{ok: true}` |
| `/chat` | POST | Sonnet 4.6 (streamed) | Tutor reply, layered system prompt with learner model + memory digest |
| `/transcribe` | POST | Whisper | Audio blob → Spanish text |
| `/extract-vocab` | POST | Haiku 4.5 | Session transcript → JSON list of vocab to flashcard |
| `/analyze` | POST | Haiku 4.5 | Session → learner model diff (grammar, vocab gaps, suggested level) |
| `/summarize` | POST | Haiku 4.5 | Long history → 2-3 sentence summary |
| `/compress-memory` | POST | Haiku 4.5 | 7+ session summaries → 500-word rolling digest |
| `/grade-pronunciation` | POST | Whisper + Haiku | Target + audio → score + feedback + missed phonemes |

All protected routes validate Firebase ID tokens and rate-limit per-user-per-day via Cloudflare KV.

## Key features

### 3 chat modes
- **💬 Text** — read-only, type or push-to-talk transcribe
- **🔊 Voice** — replies auto-play in es-MX TTS
- **🎙️ Talk** — hands-free conversation loop with silence detection (1.5s pause auto-stops, Lupita responds, listens again)

### Adaptive engine
- Every session ends → Haiku analyzes the transcript → JSON diff merged into Firebase learner model
- Next session: Worker reads learner model, builds a `LEARNER_BRIEF` (proficiency, shaky grammar, vocab gaps, phoneme weaknesses), injects into Sonnet's system prompt
- Memory digest: every ~7 sessions, Haiku compresses recent summaries into a rolling 500-word personality/context digest

### Cross-device sync
- Firebase RTDB syncs the active conversation across devices
- IndexedDB auth persistence — stay signed in across PWA reinstalls
- Conversation history archived per session, browseable in 🕘 panel

## Local dev

```bash
# Worker
cd worker
npm install
cp .dev.vars.example .dev.vars   # fill in API keys (see below)
npx wrangler dev                  # localhost:8787

# Frontend (in another terminal)
cd spanish
npx serve . --listen 3000        # localhost:3000

# Firebase rules deploy
firebase deploy --only database
```

## Required secrets (already configured for production)

**Local** (`worker/.dev.vars`):
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
FIREBASE_PROJECT_ID=maestra-lupita
FIREBASE_WEB_API_KEY=AIza...
CLOUDFLARE_PAGES_ORIGIN=http://localhost:3000
```

**Production** (Worker secrets via `wrangler secret put`):
- `ANTHROPIC_API_KEY` ✅ set
- `OPENAI_API_KEY` ✅ set

**Cloudflare Pages auto-deploy** (already configured):
- GitHub repo secret `CLOUDFLARE_API_TOKEN` ✅ set
- Workflow: `.github/workflows/deploy.yml` — runs on push to main

## Manual steps still needed

1. **Worker auto-deploy** — current Cloudflare API token only has Pages perms. Update token to include `Account → Workers Scripts: Edit`, then rename `.github/workflows/deploy-worker.yml.disabled` → `.yml`.

2. **Portal sync auto-deploy** — need a fine-grained GitHub PAT scoped to `ckholden/Holden-nerd-portal` with Contents: write. Add as repo secret `PORTAL_PUSH_TOKEN`, then rename `sync-portal.yml.disabled` → `.yml`.

Until then, syncing to Holden-nerd-portal is a manual `cp + git push` step done after each batch.

## Cost expectation

Per active month at ~15 min/day:
- Anthropic (Sonnet 4.6 chat): $4-8
- Anthropic (Haiku 4.5 analysis/extract/compress): $0.50-1
- OpenAI Whisper: $3-5
- Cloudflare + Firebase: $0 (free tier)
- **Total: ~$8-14/month**

## License

Personal project. All rights reserved.
