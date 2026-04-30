import { assembleSystemPrompt, ANALYSIS_PROMPT, SUMMARIZE_PROMPT, EXTRACT_VOCAB_PROMPT, MEMORY_COMPRESSION_PROMPT, PRONUNCIATION_GRADE_PROMPT, TRANSLATE_WORD_PROMPT, SUGGEST_REPLIES_PROMPT } from './system-prompts.js';

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function getAllowedOrigin(env, request) {
  // Comma-separated list in env, or fall back to a default set
  const raw = env.CLOUDFLARE_PAGES_ORIGIN || 'https://holdenportal.com,https://maestra-lupita.pages.dev,http://localhost:3000';
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const reqOrigin = request?.headers.get('Origin') ?? '';

  // Allow exact match OR any *.maestra-lupita.pages.dev preview deployment
  if (allowed.includes(reqOrigin)) return reqOrigin;
  if (/^https:\/\/[a-f0-9]+\.maestra-lupita\.pages\.dev$/.test(reqOrigin)) return reqOrigin;

  // Default: first allowed origin (so non-CORS callers still get something)
  return allowed[0] || '*';
}

function corsHeaders(env, request) {
  return {
    'Access-Control-Allow-Origin': getAllowedOrigin(env, request),
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function preflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(env, request) });
}

function json(data, status = 200, env, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env, request) },
  });
}

// ---------------------------------------------------------------------------
// Firebase token validation
// ---------------------------------------------------------------------------

async function validateFirebaseToken(idToken, env) {
  if (!idToken) return null;
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.users?.[0]?.localId ?? null;
  } catch {
    return null;
  }
}

function extractToken(request) {
  const auth = request.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

// ---------------------------------------------------------------------------
// Rate limiting (KV: per-user per-day buckets)
// ---------------------------------------------------------------------------

const RATE_LIMITS = {
  '/chat': 200,
  '/transcribe': 500,
  '/extract-vocab': 50,
  '/analyze': 30,
  '/summarize': 100,
  '/compress-memory': 5,
  '/grade-pronunciation': 100,
  '/daily-lesson': 20,
  '/translate-word': 200,
  '/suggest-replies': 400,
};

async function checkRateLimit(uid, route, env) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `rl:${uid}:${today}:${route}`;
  const limit = RATE_LIMITS[route] ?? 50;

  const raw = await env.RATE_LIMIT.get(key);
  const count = raw ? parseInt(raw) : 0;
  if (count >= limit) return false;

  const secondsUntilMidnight = Math.ceil(
    (new Date(today).setDate(new Date(today).getDate() + 1) - Date.now()) / 1000
  );
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: secondsUntilMidnight + 60 });
  return true;
}

// ---------------------------------------------------------------------------
// Firebase RTDB helpers (REST API — no service account needed for reads/writes
// that are already protected by security rules + ID token)
// ---------------------------------------------------------------------------

async function rtdbGet(path, idToken, env) {
  const url = `https://${env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com/${path}.json?auth=${idToken}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return resp.json();
}

async function rtdbSet(path, data, idToken, env) {
  const url = `https://${env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com/${path}.json?auth=${idToken}`;
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

async function rtdbPatch(path, data, idToken, env) {
  const url = `https://${env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com/${path}.json?auth=${idToken}`;
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Learner brief builder (pure function, no LLM needed)
// ---------------------------------------------------------------------------

function buildLearnerBrief(learnerModel) {
  if (!learnerModel) return null;

  const { proficiency, grammar, errorPatterns, pronunciation, preferences, nextRecommendedFocus } = learnerModel;

  const shaky = grammar
    ? Object.entries(grammar)
        .filter(([, v]) => v.status === 'shaky' || v.status === 'practicing')
        .map(([id]) => id.replace(/_/g, ' '))
    : [];

  const recentErrors = errorPatterns
    ? [...errorPatterns].sort((a, b) => b.count - a.count).slice(0, 3).map(e => e.pattern)
    : [];

  const phonemeWeaknesses = pronunciation?.missedPhonemes ?? [];
  const level = proficiency?.overall ?? 'unknown';
  const pacing = preferences?.pacing ?? 'moderate';
  const interests = preferences?.interests ?? [];
  const focus = nextRecommendedFocus ?? [];

  return [
    `- Proficiency: ${level}`,
    shaky.length ? `- Currently shaky: ${shaky.join(', ')}` : '- No tracked grammar weaknesses yet',
    recentErrors.length ? `- Recent error patterns: ${recentErrors.join('; ')}` : '',
    phonemeWeaknesses.length ? `- Pronunciation targets: ${phonemeWeaknesses.join(', ')}` : '',
    `- Pacing preference: ${pacing}`,
    interests.length ? `- Interests that engage him: ${interests.join(', ')}` : '',
    focus.length ? `- Recommended focus: ${focus.join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Anthropic streaming helper
// ---------------------------------------------------------------------------

async function streamAnthropicChat({ systemPrompt, messages, env, corsHdrs }) {
  const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  if (!anthropicResp.ok) {
    const err = await anthropicResp.text();
    return new Response(JSON.stringify({ error: err.slice(0, 500) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHdrs },
    });
  }

  // Transform Anthropic SSE → simplified SSE (data: {"token":"..."})
  // Buffer across chunks because SSE events can split anywhere on byte boundaries.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = '';

  function processLine(line, controller) {
    if (!line.startsWith('data: ')) return;
    const raw = line.slice(6).trim();
    if (!raw || raw === '[DONE]') return;
    try {
      const evt = JSON.parse(raw);
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: evt.delta.text })}\n\n`));
      } else if (evt.type === 'message_stop') {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } else if (evt.type === 'error') {
        const msg = evt.error?.message || 'Anthropic stream error';
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      }
    } catch {
      // malformed SSE line — skip
    }
  }

  const { readable, writable } = new TransformStream({
    transform(chunk, controller) {
      sseBuffer += decoder.decode(chunk, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? ''; // last line may be incomplete
      for (const line of lines) processLine(line, controller);
    },
    flush(controller) {
      if (sseBuffer) processLine(sseBuffer, controller);
    },
  });

  anthropicResp.body.pipeTo(writable).catch(() => {});

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...corsHdrs,
    },
  });
}

// ---------------------------------------------------------------------------
// Haiku JSON helper (non-streaming, for analysis/extract/summarize)
// ---------------------------------------------------------------------------

async function callHaiku({ systemPrompt, userContent, env }) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!resp.ok) throw new Error(`Haiku error: ${resp.status}`);
  const data = await resp.json();
  return data.content?.[0]?.text ?? '';
}

// ---------------------------------------------------------------------------
// Route: POST /chat
// ---------------------------------------------------------------------------

async function handleChat(request, uid, idToken, env) {
  const corsHdrs = corsHeaders(env, request);
  const allowed = await checkRateLimit(uid, '/chat', env);
  if (!allowed) return json({ error: 'Daily chat limit reached' }, 429, env, request);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, env, request); }

  const {
    messages = [],
    mode = 'chat',
    correctionMode = 'gentle',
    scenario = null,
    topic = null,
    lesson = null,
    sessionSummary = null,
  } = body;

  // Load learner model + memory digest from Firebase (best-effort; don't block on failure)
  const [learnerModel, memoryDigest] = await Promise.all([
    rtdbGet(`users/${uid}/learnerModel`, idToken, env).catch(() => null),
    rtdbGet(`users/${uid}/memoryDigest/summary`, idToken, env).catch(() => null),
  ]);

  const learnerBrief = buildLearnerBrief(learnerModel);

  // Enforce 20-turn cap (older history already summarized by client)
  const trimmedMessages = messages.slice(-40); // 20 turns = up to 40 messages

  // If client sent a session summary (from prior truncation), inject as context
  const finalMessages = sessionSummary
    ? [{ role: 'user', content: `[Resumen de la sesión anterior: ${sessionSummary}]` }, { role: 'assistant', content: 'Entendido. Continuemos.' }, ...trimmedMessages]
    : trimmedMessages;

  const systemPrompt = assembleSystemPrompt({
    mode,
    correctionMode,
    learnerBrief,
    memoryDigest: typeof memoryDigest === 'string' ? memoryDigest : null,
    scenario,
    topic,
    lesson,
  });

  return streamAnthropicChat({ systemPrompt, messages: finalMessages, env, corsHdrs });
}

// ---------------------------------------------------------------------------
// Route: POST /transcribe (audio blob → Whisper → text)
// ---------------------------------------------------------------------------

async function handleTranscribe(request, uid, env) {
  const allowed = await checkRateLimit(uid, '/transcribe', env);
  if (!allowed) return json({ error: 'Daily transcription limit reached' }, 429, env, request);

  const ct = request.headers.get('Content-Type') || '';
  if (!ct.startsWith('multipart/form-data')) {
    return json({ error: 'Expected multipart/form-data with audio file' }, 400, env, request);
  }

  // Forward the multipart body to OpenAI Whisper.
  // We re-build the FormData on our side so we can force model + language.
  let incoming;
  try { incoming = await request.formData(); } catch { return json({ error: 'Bad multipart body' }, 400, env, request); }

  const audio = incoming.get('audio');
  if (!audio || typeof audio === 'string') return json({ error: 'No audio file' }, 400, env, request);

  const out = new FormData();
  out.append('file', audio, audio.name || 'audio.webm');
  out.append('model', 'whisper-1');
  out.append('language', 'es');
  out.append('response_format', 'json');
  // Prompt biases Whisper toward expected content — reduces hallucinations
  out.append('prompt', 'Una conversación de práctica de español entre una estudiante de enfermería y su tutora mexicana. Los temas incluyen vida diaria, español médico, y conversación informal.');
  out.append('temperature', '0');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body: out,
  });

  if (!resp.ok) {
    const err = await resp.text();
    return json({ error: `Whisper error: ${err.slice(0, 200)}` }, 502, env, request);
  }

  const data = await resp.json();
  const cleaned = filterWhisperHallucinations(data.text || '');
  return json({ text: cleaned }, 200, env, request);
}

/**
 * Whisper occasionally hallucinates subtitle/credit text when audio is silent
 * or unclear (Amara.org, "thanks for watching", Korean/Japanese auto-credits).
 * Filter these and return empty string — frontend treats empty as "didn't catch that".
 */
function filterWhisperHallucinations(text) {
  const t = (text || '').trim();
  if (!t) return '';

  const hallucinations = [
    /amara\.org/i,
    /subt[ií]tulos\s+(?:realizados|por|de)/i,
    /subtitles?\s+(?:by|community)/i,
    /thanks\s+for\s+watching/i,
    /subscribe\s+(?:to|for)/i,
    /^[\.…\s]+$/,
    /ご視聴ありがとうございました/, // Japanese "thanks for watching"
    /MBC\s*뉴스/, // Korean news
    /字幕\s*by/i,
    /^(?:um|uh|hmm|er|ah)\.?$/i, // pure filler tokens (Whisper artifact)
  ];
  for (const pattern of hallucinations) {
    if (pattern.test(t)) return ''; // treat as silent
  }
  return t;
}

// ---------------------------------------------------------------------------
// Route: POST /analyze (post-session Haiku analysis → learner model diff)
// ---------------------------------------------------------------------------

async function handleAnalyze(request, uid, idToken, env) {
  const allowed = await checkRateLimit(uid, '/analyze', env);
  if (!allowed) return json({ error: 'Daily analysis limit reached' }, 429, env, request);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, env, request); }
  const { messages = [] } = body;

  if (messages.length < 2) return json({ ok: true, skipped: 'too short' }, 200, env, request);

  // Build a transcript string for Haiku to analyze
  const transcript = messages
    .filter((m) => m.content && !m.content.startsWith('[SCENARIO START') && !m.content.startsWith('[MEDICAL TOPIC START'))
    .map((m) => `${m.role === 'user' ? 'Christian' : 'Lupita'}: ${m.content}`)
    .join('\n\n');

  let raw;
  try {
    raw = await callHaiku({ systemPrompt: ANALYSIS_PROMPT, userContent: transcript, env });
  } catch (err) {
    return json({ error: `Haiku error: ${err.message}` }, 502, env, request);
  }

  // Strip any markdown code fences and parse JSON
  let analysis;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    analysis = JSON.parse(cleaned);
  } catch {
    return json({ error: 'Haiku returned non-JSON', raw }, 502, env, request);
  }

  // Merge into existing learnerModel — union arrays, deduplicate
  const existing = (await rtdbGet(`users/${uid}/learnerModel`, idToken, env)) || {};
  const merged = mergeLearnerModel(existing, analysis);

  await rtdbPatch(`users/${uid}/learnerModel`, merged, idToken, env);

  // Append session summary to recentSessionSummaries (keep last 10)
  if (analysis.sessionSummary) {
    const recents = (await rtdbGet(`users/${uid}/learnerModel/recentSessionSummaries`, idToken, env)) || [];
    const arr = Array.isArray(recents) ? recents : Object.values(recents);
    arr.push({ summary: analysis.sessionSummary, at: Date.now() });
    while (arr.length > 10) arr.shift();
    await rtdbSet(`users/${uid}/learnerModel/recentSessionSummaries`, arr, idToken, env);
  }

  return json({ ok: true, analysis }, 200, env, request);
}

function mergeLearnerModel(existing, diff) {
  const merged = { ...existing };
  merged.lastAnalyzedAt = Date.now();

  // Grammar weaknesses — track each with a count
  const grammarCounts = existing.grammarWeaknessCounts || {};
  for (const w of (diff.grammarWeaknesses || [])) {
    grammarCounts[w] = (grammarCounts[w] || 0) + 1;
  }
  merged.grammarWeaknessCounts = grammarCounts;
  // Also keep the top N as a flat list for prompt injection
  merged.grammarWeaknesses = Object.entries(grammarCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  // Vocab gaps — union, capped to most-recent 30
  const vocabSet = new Set([...(existing.vocabGaps || []), ...(diff.vocabGaps || [])]);
  merged.vocabGaps = [...vocabSet].slice(-30);

  // Pronunciation
  const pronExisting = existing.pronunciation || { missedPhonemes: [], missedWords: [], sessionsGraded: 0 };
  const pronDiff = diff.pronunciation || {};
  merged.pronunciation = {
    missedPhonemes: [...new Set([...(pronExisting.missedPhonemes || []), ...(pronDiff.missedPhonemes || [])])].slice(-15),
    missedWords: [...new Set([...(pronExisting.missedWords || []), ...(pronDiff.missedWords || [])])].slice(-30),
    sessionsGraded: pronExisting.sessionsGraded || 0,
  };

  // Suggested level: only update if Haiku has suggested same level twice in a row
  if (diff.suggestedLevel) {
    const lastSuggested = existing._lastSuggestedLevel;
    if (lastSuggested === diff.suggestedLevel) {
      merged.proficiency = {
        ...(existing.proficiency || {}),
        overall: diff.suggestedLevel,
        lastEstimatedAt: Date.now(),
      };
    }
    merged._lastSuggestedLevel = diff.suggestedLevel;
  }

  // Engagement signal — keep last 5
  const engagementHist = existing.engagementHistory || [];
  if (diff.engagementSignal) {
    engagementHist.push({ signal: diff.engagementSignal, at: Date.now() });
    while (engagementHist.length > 5) engagementHist.shift();
  }
  merged.engagementHistory = engagementHist;

  // Recommended next focus
  if (diff.recommendedNextFocus?.length) {
    merged.nextRecommendedFocus = diff.recommendedNextFocus.slice(0, 3);
  }

  // Teaching notes (what's working with this student)
  if (diff.techniqueAssessment) {
    const notes = existing.teachingNotes || [];
    if (diff.techniqueAssessment.whatWorked) notes.push({ kind: 'works', note: diff.techniqueAssessment.whatWorked, at: Date.now() });
    if (diff.techniqueAssessment.whatDidntLand) notes.push({ kind: 'avoid', note: diff.techniqueAssessment.whatDidntLand, at: Date.now() });
    while (notes.length > 20) notes.shift();
    merged.teachingNotes = notes;
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Route: POST /extract-vocab (Haiku → list of new vocabulary worth flashcarding)
// ---------------------------------------------------------------------------

async function handleExtractVocab(request, uid, env) {
  const allowed = await checkRateLimit(uid, '/extract-vocab', env);
  if (!allowed) return json({ error: 'Daily extract limit reached' }, 429, env, request);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, env, request); }
  const { messages = [] } = body;
  if (messages.length < 2) return json({ vocab: [] }, 200, env, request);

  const transcript = messages
    .filter((m) => m.content && !m.content.startsWith('[SCENARIO START') && !m.content.startsWith('[MEDICAL TOPIC START'))
    .map((m) => `${m.role === 'user' ? 'Christian' : 'Lupita'}: ${m.content}`)
    .join('\n\n');

  let raw;
  try {
    raw = await callHaiku({ systemPrompt: EXTRACT_VOCAB_PROMPT, userContent: transcript, env });
  } catch (err) {
    return json({ error: `Haiku error: ${err.message}` }, 502, env, request);
  }

  let vocab = [];
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    vocab = JSON.parse(cleaned);
    if (!Array.isArray(vocab)) vocab = [];
  } catch {
    return json({ error: 'Haiku returned non-JSON', raw }, 502, env, request);
  }

  return json({ vocab }, 200, env, request);
}

// ---------------------------------------------------------------------------
// Route: POST /summarize (Haiku 2-3 sentence session summary for history truncation)
// ---------------------------------------------------------------------------

async function handleSummarize(request, uid, env) {
  const allowed = await checkRateLimit(uid, '/summarize', env);
  if (!allowed) return json({ error: 'Daily summarize limit reached' }, 429, env, request);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, env, request); }
  const { turns = [] } = body;
  if (!turns.length) return json({ summary: '' }, 200, env, request);

  const transcript = turns
    .map((m) => `${m.role === 'user' ? 'Christian' : 'Lupita'}: ${m.content}`)
    .join('\n\n');

  try {
    const summary = await callHaiku({ systemPrompt: SUMMARIZE_PROMPT, userContent: transcript, env });
    return json({ summary: summary.trim() }, 200, env, request);
  } catch (err) {
    return json({ error: `Haiku error: ${err.message}` }, 502, env, request);
  }
}

// ---------------------------------------------------------------------------
// Route: POST /compress-memory (every ~7 sessions, compress recent summaries
// into the rolling cross-session digest)
// ---------------------------------------------------------------------------

async function handleCompressMemory(request, uid, idToken, env) {
  const allowed = await checkRateLimit(uid, '/compress-memory', env);
  if (!allowed) return json({ error: 'Memory compression rate limited' }, 429, env, request);

  const existing = (await rtdbGet(`users/${uid}/memoryDigest/summary`, idToken, env)) || '';
  const recents = (await rtdbGet(`users/${uid}/learnerModel/recentSessionSummaries`, idToken, env)) || [];
  const arr = Array.isArray(recents) ? recents : Object.values(recents);
  if (!arr.length) return json({ ok: true, skipped: 'no recents' }, 200, env, request);

  const userContent = `EXISTING DIGEST:\n${existing || '(none yet)'}\n\nRECENT SESSION SUMMARIES (newest last):\n${arr.map((s, i) => `${i + 1}. ${s.summary || s}`).join('\n')}`;

  let summary;
  try {
    summary = (await callHaiku({ systemPrompt: MEMORY_COMPRESSION_PROMPT, userContent, env })).trim();
  } catch (err) {
    return json({ error: `Haiku error: ${err.message}` }, 502, env, request);
  }

  await rtdbSet(`users/${uid}/memoryDigest`, {
    summary,
    updatedAt: Date.now(),
    sessionsSummarized: arr.length,
  }, idToken, env);

  return json({ ok: true, summary }, 200, env, request);
}

// ---------------------------------------------------------------------------
// Route: POST /grade-pronunciation (target + audio → score + feedback)
// ---------------------------------------------------------------------------

async function handleGradePronunciation(request, uid, idToken, env) {
  const allowed = await checkRateLimit(uid, '/grade-pronunciation', env);
  if (!allowed) return json({ error: 'Daily pronunciation limit reached' }, 429, env, request);

  const ct = request.headers.get('Content-Type') || '';
  if (!ct.startsWith('multipart/form-data')) {
    return json({ error: 'Expected multipart/form-data with audio + target' }, 400, env, request);
  }

  let incoming;
  try { incoming = await request.formData(); } catch { return json({ error: 'Bad multipart body' }, 400, env, request); }

  const audio = incoming.get('audio');
  const target = incoming.get('target');
  if (!audio || typeof audio === 'string') return json({ error: 'No audio file' }, 400, env, request);
  if (!target || typeof target !== 'string') return json({ error: 'No target phrase' }, 400, env, request);

  // 1. Transcribe via Whisper
  const out = new FormData();
  out.append('file', audio, audio.name || 'practice.webm');
  out.append('model', 'whisper-1');
  out.append('language', 'es');
  out.append('response_format', 'json');

  const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body: out,
  });
  if (!whisperResp.ok) {
    const err = await whisperResp.text();
    return json({ error: `Whisper error: ${err.slice(0, 200)}` }, 502, env, request);
  }
  const { text: heard = '' } = await whisperResp.json();

  // 2. Grade via Haiku
  let grade;
  try {
    const raw = await callHaiku({
      systemPrompt: PRONUNCIATION_GRADE_PROMPT,
      userContent: `TARGET: "${target}"\nHEARD: "${heard}"`,
      env,
    });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    grade = JSON.parse(cleaned);
  } catch {
    // Fallback: Levenshtein-only score if Haiku fails
    const dist = levenshtein(target.toLowerCase().trim(), heard.toLowerCase().trim());
    const score = Math.max(0, Math.round(100 * (1 - dist / Math.max(target.length, 1))));
    grade = { score, feedback: `I heard: "${heard}"`, missedPhonemes: [], missedWords: [] };
  }

  // 3. Update learner model pronunciation
  if (grade.missedPhonemes?.length || grade.missedWords?.length) {
    const existing = (await rtdbGet(`users/${uid}/learnerModel/pronunciation`, idToken, env)) || { missedPhonemes: [], missedWords: [], sessionsGraded: 0 };
    const updated = {
      missedPhonemes: [...new Set([...(existing.missedPhonemes || []), ...(grade.missedPhonemes || [])])].slice(-15),
      missedWords: [...new Set([...(existing.missedWords || []), ...(grade.missedWords || [])])].slice(-30),
      sessionsGraded: (existing.sessionsGraded || 0) + 1,
      lastGradedAt: Date.now(),
    };
    await rtdbSet(`users/${uid}/learnerModel/pronunciation`, updated, idToken, env);
  }

  return json({ heard, ...grade }, 200, env, request);
}

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

// ---------------------------------------------------------------------------
// Route: POST /translate-word (tap-word-for-translation in chat)
// ---------------------------------------------------------------------------

async function handleTranslateWord(request, uid, env) {
  const allowed = await checkRateLimit(uid, '/translate-word', env);
  if (!allowed) return json({ error: 'Daily translate limit reached' }, 429, env, request);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, env, request); }
  const { word = '', sentence = '' } = body;
  if (!word.trim()) return json({ error: 'No word provided' }, 400, env, request);

  const userContent = `WORD: "${word}"\nSENTENCE CONTEXT: "${sentence}"`;

  let raw;
  try {
    raw = await callHaiku({ systemPrompt: TRANSLATE_WORD_PROMPT, userContent, env });
  } catch (err) {
    return json({ error: `Haiku error: ${err.message}` }, 502, env, request);
  }

  let result;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    result = JSON.parse(cleaned);
  } catch {
    return json({ error: 'Haiku returned non-JSON', raw }, 502, env, request);
  }

  return json(result, 200, env, request);
}

// Add rate-limit budget
// (Add /translate-word to the RATE_LIMITS map at top of file as well)

// ---------------------------------------------------------------------------
// Route: POST /suggest-replies (3 tappable response chips below Lupita's last)
// ---------------------------------------------------------------------------

async function handleSuggestReplies(request, uid, idToken, env) {
  const allowed = await checkRateLimit(uid, '/suggest-replies', env);
  if (!allowed) return json({ suggestions: [] }, 200, env, request); // fail soft — chips are optional

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, env, request); }
  const { messages = [] } = body;
  if (messages.length < 1) return json({ suggestions: [] }, 200, env, request);

  // Pull learner level for tailoring
  const learnerModel = await rtdbGet(`users/${uid}/learnerModel`, idToken, env).catch(() => null);
  const level = learnerModel?.proficiency?.overall || 'A2';

  // Last 6 turns is plenty of context
  const recent = messages.slice(-6);
  const transcript = recent
    .filter((m) => !m.content?.startsWith('[SCENARIO START') && !m.content?.startsWith('[MEDICAL TOPIC START') && !m.content?.startsWith('[LESSON START'))
    .map((m) => `${m.role === 'user' ? 'Christian' : 'Lupita'}: ${m.content}`)
    .join('\n\n');

  const userContent = `LEARNER LEVEL: ${level}\n\nCONVERSATION:\n${transcript}\n\nSuggest 3 next replies for Christian.`;

  let raw;
  try {
    raw = await callHaiku({ systemPrompt: SUGGEST_REPLIES_PROMPT, userContent, env });
  } catch {
    return json({ suggestions: [] }, 200, env, request); // fail soft
  }

  let result;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    result = JSON.parse(cleaned);
  } catch {
    return json({ suggestions: [] }, 200, env, request);
  }

  return json({ suggestions: Array.isArray(result.suggestions) ? result.suggestions.slice(0, 3) : [] }, 200, env, request);
}

// ---------------------------------------------------------------------------
// Route: GET /health
// ---------------------------------------------------------------------------

function handleHealth(env, request) {
  return json({ ok: true, ts: Date.now() }, 200, env, request);
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight
    if (request.method === 'OPTIONS') return preflight(request, env);

    // Health (unauthenticated)
    if (path === '/health' && request.method === 'GET') return handleHealth(env, request);

    // All other routes require auth
    const idToken = extractToken(request);
    const uid = await validateFirebaseToken(idToken, env);
    if (!uid) return json({ error: 'Unauthorized' }, 401, env, request);

    if (path === '/chat' && request.method === 'POST') return handleChat(request, uid, idToken, env);
    if (path === '/transcribe' && request.method === 'POST') return handleTranscribe(request, uid, env);
    if (path === '/analyze' && request.method === 'POST') return handleAnalyze(request, uid, idToken, env);
    if (path === '/summarize' && request.method === 'POST') return handleSummarize(request, uid, env);
    if (path === '/extract-vocab' && request.method === 'POST') return handleExtractVocab(request, uid, env);
    if (path === '/compress-memory' && request.method === 'POST') return handleCompressMemory(request, uid, idToken, env);
    if (path === '/grade-pronunciation' && request.method === 'POST') return handleGradePronunciation(request, uid, idToken, env);
    if (path === '/translate-word' && request.method === 'POST') return handleTranslateWord(request, uid, env);
    if (path === '/suggest-replies' && request.method === 'POST') return handleSuggestReplies(request, uid, idToken, env);

    return json({ error: 'Not found' }, 404, env, request);
  },
};
