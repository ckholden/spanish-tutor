# Overnight Build Summary

What got built while you stepped away. **Live on both URLs:**
- 📱 https://maestra-lupita.pages.dev
- 🌐 https://holdenportal.com/spanish

## ✅ Phases shipped tonight

| # | Phase | What it does |
|---|---|---|
| 5 | **Adaptive Engine** | Every session → Haiku analyzes transcript → updates your learner model in Firebase. Next session, Lupita's system prompt includes "Christian is shaky on subjunctive, recently struggled with these words…" so she actively targets your weak spots. |
| 3 | **Vocab Flashcards (SRS)** | After each chat, Haiku auto-extracts new vocab into your Vocab tab. Spaced-repetition schedule: 1d → 3d → 7d → 14d → 30d → 90d. Forgot/Hard/Easy buttons. Pronounce button. |
| 8 | **Pronunciation Grading** | On any flashcard review, tap 🎤 Practice → speak the word → Whisper transcribes + Haiku scores you 0-100 with specific feedback (e.g. "the 'rr' came out flat — roll your tongue more"). Missed phonemes feed back into your learner model. |
| 7 | **Medical Spanish** | New tab. 10 nursing-focused topics: patient intake, pain assessment, vitals teaching, med teaching, procedures, discharge, emergency phrases, familismo cultural notes, false-cognate pitfalls (embarazada≠embarrassed!), and end-of-life conversations. Each opens in-character with a brief English intro + cultural note, then transitions to Spanish practice. |
| 6 | **Memory Digest** | Every 7 sessions, Haiku compresses recent session summaries into a rolling 500-word personality/context digest. Lupita can naturally reference things you mentioned weeks ago. |

## ✅ UX/Architecture improvements

- **3-mode chat selector** in header: Text 💬 / Voice 🔊 / Talk 🎙️
  - Text = read replies
  - Voice = TTS auto-plays
  - Talk = hands-free conversation loop with silence detection
- **Conversation history** (🕘 button, top right) — past sessions browseable + reopenable
- **Cross-device sync** — Firebase RTDB syncs active chat; IndexedDB auth persistence so you stay signed in across PWA reinstalls
- **PWA install** — manifest, service worker, icons (192/512/apple-touch). On iPhone: Share → Add to Home Screen → real Lupita icon
- **Mobile UX** — tab bar moves to bottom on phone (thumb reach), notch-safe, 44pt taps, mode pills become icon-only on narrow screens
- **GitHub source repo** — [ckholden/spanish-tutor](https://github.com/ckholden/spanish-tutor) with auto-deploy workflow that pushes to Cloudflare Pages on every commit to main

## ⏳ Still pending (manual steps for you)

These require your browser auth — I genuinely can't do them via CLI.

### 1. Worker auto-deploy (1 min)
Your Cloudflare API token only has Pages perms. To enable auto-deploy of Worker changes too:
- https://dash.cloudflare.com/profile/api-tokens → **Edit** the existing token → add `Account → Workers Scripts → Edit` → Save
- Then rename `.github/workflows/deploy-worker.yml.disabled` → `.yml` and commit

Until then, Worker changes deploy manually via `cd worker && npx wrangler deploy`.

### 2. Portal sync auto-deploy (1 min)
Sync of `spanish/` → `Holden-nerd-portal/spanish/` is currently manual. To auto-sync:
- https://github.com/settings/personal-access-tokens/new
- Token name: `spanish-tutor-sync`
- Repository access: **only `ckholden/Holden-nerd-portal`**
- Repository permissions: **Contents → Read and write**
- Generate → paste in chat, I'll set the GitHub secret + re-enable the workflow

### 3. Rotate exposed API keys
You pasted these in chat earlier (now in transcript) — rotate before going public:
- Anthropic key at https://console.anthropic.com/settings/keys
- OpenAI key at https://platform.openai.com/api-keys
- Cloudflare token at https://dash.cloudflare.com/profile/api-tokens

After rotating: I'll update `.dev.vars` + Worker secrets via `wrangler secret put` + GitHub secret.

## 📋 Audit running

I launched two expert agents auditing the codebase right now:
1. **nursing-education-systems-architect** — pedagogy review + medical Spanish accuracy
2. **general-purpose** — engineering audit (bugs, mobile UX, performance)

When they finish, I'll write up a punch list of bugs + easy wins and start working through them. Specifically targeting "beat Speak" UX bar.

## 🗺️ Roadmap from here

Everything above is built. The audit will surface what's next. My current expectation:
1. Address bugs found in audit
2. Add Daily Focus card on home (pulls from learner model)
3. Markdown rendering in chat messages (currently `**bold**` shows literal asterisks)
4. Typing indicator while Lupita is "thinking" before stream starts
5. Streak + daily-goal tracker (Phase 9 partial)
6. Final visual polish pass

## How to test the new stuff

**Quick smoke test** (5 min):
1. Open the URL, sign in
2. Send a chat message → response should stream
3. Tap **Vocab** tab → after a chat, new words should appear here
4. Tap **Medical** tab → pick "Patient Intake" → Lupita should open in-character as a Mexican patient
5. Tap **Scenarios** tab → pick "Pidiendo tacos" → similar
6. Tap **🎙️ Talk** mode pill → hands-free conversation overlay should open
7. Tap **🕘 history** (top right) → see past conversations after archiving one

**Adaptive engine test** (after 2-3 sessions):
- Look at your Firebase RTDB at `/users/{your-uid}/learnerModel` — should have grammarWeaknesses, vocabGaps, etc. populating

**Pronunciation test**:
- Vocab tab → tap "🃏 Review N cards"
- On flashcard back, tap "🎤 Practice pronunciation"
- Speak the word, tap to score → see 0-100 score + feedback
