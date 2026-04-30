import { assembleSystemPrompt } from './system-prompts.js';

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
  out.append('language', 'es'); // bias toward Spanish; users still bilingual will work
  out.append('response_format', 'json');

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
  return json({ text: data.text || '' }, 200, env, request);
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

    return json({ error: 'Not found' }, 404, env, request);
  },
};
