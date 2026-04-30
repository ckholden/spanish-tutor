# Maestra Lupita — Overnight Build Handoff

Everything done while you stepped away. **Live on both URLs:**
- 📱 **https://maestra-lupita.pages.dev** (Cloudflare Pages — auto-deploys on push)
- 🌐 **https://holdenportal.com/spanish** (GitHub Pages — manually synced)

---

## TL;DR

Phases 3 / 5 / 6 / 7 / 8 / 9 all built. Two expert audits ran. ~30 of their 60+ findings are already fixed. The app is now meaningfully closer to "beat Speak" — markdown rendering, typing indicator, Today's Focus card with streak + quick-start chips, teach-back loops in medical scenarios, expanded medical content (now 17 topics), tightened SRS schedule with leech detection, mobile keyboard fixes, toast notifications, and a half-dozen genuine bug fixes.

---

## ✅ Phases shipped tonight

| # | Phase | What it does |
|---|---|---|
| 5 | **Adaptive Engine** | Every session ends → Haiku analyzes the transcript → JSON diff merged into Firebase learner model. Next session, Lupita's system prompt includes "Christian is shaky on subjunctive, recently fumbled these words…" so she actively targets weak spots. Visibility-change trigger respects mid-stream guard. |
| 3 | **Vocab Flashcards (SRS)** | Auto-extracts new vocab after each chat via Haiku. Tightened curve (1d→2d→5d→10d→21d→45d→90d). "Hard" multiplies by 1.2 (no longer overcorrects backward). Leech detection at 5+ lapses. Forgot/Hard/Easy buttons + Pronounce + 🎤 Practice. |
| 8 | **Pronunciation Grading** | On flashcard review, tap 🎤 Practice → speak → Whisper transcribes + Haiku scores 0-100 with specific feedback. Missed phonemes feed back into learner model. |
| 7 | **Medical Spanish (17 topics now)** | Originals: intake, pain, vitals, meds, procedures, discharge, emergency, familismo, false-cognates, end-of-life. **Added per audit:** interpreter triage (incl. Mixteco/Triqui), pediatric parent interview, labor & delivery, mental health screening, substance use, OHP/insurance navigation. Each topic now ends with a **teach-back step** (audit recommendation #1). |
| 6 | **Memory Digest** | Every ~7 sessions, Haiku compresses recent summaries into a rolling 500-word personality/context digest. Lupita can naturally reference things you mentioned weeks ago. |
| 9 | **PWA install** | manifest, service worker, icons (192/512/apple-touch + favicon). Network-first for HTML, cache-first for assets. iPhone: Share → Add to Home Screen → real Lupita icon. Service worker fixed to NOT serve HTML for missing JS (the silent breaker). |

## ✅ UX / "Beat Speak" features added

- **3-mode chat selector** in header: 💬 Text / 🔊 Voice / 🎙️ Talk (hands-free conversation loop)
- **Today's Focus card** on empty chat — streak counter (🔥 with thresholds at 3/7), due cards CTA, recommended focus from learner model, quick-start chips ("¿Cómo estuvo tu día?", "Grammar tune-up", "Order food", "Patient intake practice")
- **Streak tracker** — increments on first send of each day, resets on missed day, longest-best celebration
- **Typing indicator** (animated dots) before Lupita's first token arrives — eliminates the dead-air feel
- **Markdown rendering** in messages — `**bold**` actually renders bold now (was showing literal asterisks)
- **Auto-grow textarea** — multi-line input expands up to 6 lines instead of staying tiny
- **iOS keyboard scroll fix** — when virtual keyboard pops, chat auto-scrolls to bottom (visualViewport.resize)
- **Toast notifications** — replaces some noisy alert() popups with subtle slide-down toasts
- **Conversation history** (🕘 button, top right) — past sessions browseable; opening a past medical/scenario restores its banner correctly
- **Cross-device sync** — Firebase RTDB + IndexedDB auth persistence
- **Tap targets** — min-width 44px on all icon buttons
- **Conversation Mode** safe-area padding for iPhone home indicator
- **GitHub Actions auto-deploy** — every push to main → live on Pages within 30s

## ✅ Bugs fixed (engineering audit)

- **#1** initChat duplicate listener registration on auth state changes
- **#2-4** Scenario/Medical kickoff dead-handler leaks + double-token rendering
- **#6** TTS-end interval leaks (now single shared watcher)
- **#8** History panel restoring scenarios/medical sessions without their banner
- **#14** /analyze trigger firing mid-stream and capturing partial reply
- **#16, #18** Service worker missing module files in shell + serving HTML for 404 JS
- **#20** Markdown bold rendering as literal `**asterisks**`

## ✅ Pedagogy improvements (nursing-ed audit)

- **Teach-back step** required at end of every medical topic — converts recognition → production
- **SRS schedule tightened** — front-load review (day-1 was too late, day-90 was too aggressive)
- **"Hard" button** no longer steps backward — multiplies interval by 1.2 instead
- **Leech detection** — chronically-failed cards (5+ lapses) get flagged
- **Emergency cultural note corrected** — keep usted-form even in urgency (audit caught this was wrong)
- **False-cognate list expanded** — added actualmente, injuria, aplicación (clinically dangerous)
- **Indigenous-language patient awareness** — interpreter topic specifically calls out Mixteco/Triqui Oregon population
- **Mental health, OB, peds, substance use, OHP** scenarios — high-value gaps the audit identified for an Oregon nursing student

---

## ⏳ Still pending — manual steps that need YOUR browser

I genuinely cannot do these via CLI without your auth.

### 1. Worker auto-deploy (1 min)
The current Cloudflare API token only has Pages perms. To auto-deploy Worker changes:
- https://dash.cloudflare.com/profile/api-tokens → **Edit** the existing token → add `Account → Workers Scripts → Edit` → Save
- Then rename `.github/workflows/deploy-worker.yml.disabled` → `.yml` (commit)

Until then, Worker changes deploy via `cd worker && npx wrangler deploy`.

### 2. Portal sync auto-deploy (1 min)
Sync of `spanish/` → `Holden-nerd-portal/spanish/` is currently manual. To auto-sync:
- https://github.com/settings/personal-access-tokens/new
- Token name: `spanish-tutor-sync`
- Repository access: **only `ckholden/Holden-nerd-portal`**
- Repository permissions: **Contents → Read and write**
- Generate → paste in chat → I'll set the secret + re-enable workflow

### 3. Rotate exposed API keys
You pasted these in chat (now in transcript) — rotate before going public:
- Anthropic key at https://console.anthropic.com/settings/keys
- OpenAI key at https://platform.openai.com/api-keys
- Cloudflare token at https://dash.cloudflare.com/profile/api-tokens

After rotating: I update `.dev.vars` + Worker secrets via `wrangler secret put` + GitHub secret.

### 4. Cloudflare Pages → GitHub git connect (optional)
Currently we use a GitHub Actions workflow to push to Pages. The native CF-to-GH integration would let us see deploys in the CF dashboard but isn't required. Skippable.

---

## 🟡 Audit findings NOT yet addressed (next round)

These are real but didn't make tonight's batch. Listed by priority:

### Highest-impact remaining
1. **Tap-word-for-translation** (audit #52) — Speak's killer feature. Tap any word in Lupita's reply → see translation + add to vocab. Needs a `/translate-word` Worker route + word-tokenizer + popover UI. ~1 hour of work.
2. **Suggested replies during chat** (audit #55) — 2-3 tappable response chips under each Lupita message ("¿Puedes repetir?", "I don't understand", "Try a different word"). Reduces blank-page anxiety.
3. **Inline pronunciation feedback in conversation** (audit #53) — Run `/grade-pronunciation` on user voice in conv mode + highlight problem words inline.
4. **Daily-goal tracker + minutes-today** — Speak shows weekly goal progress. We have the streak but not minute-counting yet.
5. **Progressive lesson curriculum** — "Lesson 1 of 5" structure on top of free chat / scenarios. Without this, app feels like an open canvas.

### Engineering polish remaining
- **Long-press mic for hold-to-talk** (audit #47) — WhatsApp pattern, more natural than tap-tap
- **Skeleton loaders** for vocab + scenarios tabs (audit #48)
- **Splash screens** for iOS PWA full-screen launch (audit #37)
- **Firebase SDK consolidation** — three CDN imports cascade is ~150KB extra (audit #39)
- **Dynamic-import medical/vocab/scenarios** so they don't load until tab is opened (audit #40)
- **Haptics** on iOS — `navigator.vibrate(8)` on send/mic/card flip (audit #51)
- **Replace remaining alert/confirm/prompt with toast/modal** — `chat-clear`, mic errors, manual vocab add still use native dialogs

### Pedagogy improvements remaining
- **Cued recall direction** in flashcards — flip half the deck so you produce Spanish from English prompt (audit pedagogy #3)
- **Same-session 10-minute review** for new vocab — highest-leverage forgetting-curve hack (audit pedagogy SRS #1)
- **Example-sentence cloze** — show example with target word blanked
- **Productive vs. comprehension split** in learner model
- **Pre-scenario cultural note card** (currently only in banner during the chat) — show before the practice starts
- **Post-session digest visible to learner** — close the metacognitive loop
- **Canonical grammar taxonomy** in ANALYSIS_PROMPT — current freeform strings dedupe poorly
- **Mastery decay** — concepts marked shaky stay shaky forever; should fade after N successful sessions
- **Haiku-driven placement quiz** (currently a 4-button self-assessment) — wiring exists but unused

### Speak parity gaps
- Word-by-word translation tap (above)
- Inline pronunciation in conversation (above)
- Suggested replies (above)
- Lesson curriculum / "what should I do today" (above)
- Better visual progress dashboard (mastered words count, hours studied, weak grammar tracker)

---

## 🗺️ How to test the new stuff

### Smoke test (5 min)
1. Hard refresh the URL
2. Empty chat → see Today's Focus card with streak + quick-start chips
3. Tap "¿Cómo estuvo tu día?" chip → message auto-sends, see typing dots → reply streams
4. **Vocab** tab → after 1-2 chats, words should auto-appear here
5. **Medical** tab → 17 topics now (added interpreter, peds, OB, mental health, substance, OHP)
6. Pick a medical topic → at the end you should now get a **teach-back step** ("ahora cambiemos roles…")
7. **🕘 history** → archive current with 🗑️, browse past sessions, reopen one → banner restores correctly
8. **🎙️ Talk** mode → hands-free conversation overlay (safe-area padded for home indicator)

### Adaptive engine
- After 2-3 real chat sessions, check Firebase RTDB at `/users/{your-uid}/learnerModel` — should have grammarWeaknesses, vocabGaps, etc. populating

### Streak
- First send today → streak = 1
- Miss a day → streak resets to 1 next time
- Keep streak alive → emoji escalates 🌱 → ⭐ → 🔥

---

## 📁 Repo state

- Source: https://github.com/ckholden/spanish-tutor
- Portal: https://github.com/ckholden/Holden-nerd-portal (`/spanish` directory)
- Pages: https://maestra-lupita.pages.dev
- Worker: https://maestra-lupita-worker.christiankholden.workers.dev
- Firebase: project `maestra-lupita` (RTDB rules deployed, per-UID lockdown)
