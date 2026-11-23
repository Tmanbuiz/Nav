/**
 * ChurchRide AI Worker
 *
 *   GET  /v1/health   -> { ok: true, ai: true, model }
 *   POST /v1/extract  { text } -> { assignments: [...] }
 *
 * Every request needs "Authorization: Bearer <APP_TOKEN>" (a Wrangler secret).
 * Only used for texts the app's on-device parser can't read. Logs never include
 * the text or any rider details, only counts and timings.
 */
import { AiReadError, extractAssignments, type RunModel } from './extract';

const MAX_BODY_BYTES = 16 * 1024;

export default {
  async fetch(request, env): Promise<Response> {
    const run: RunModel = (input) => env.AI.run(env.AI_MODEL, input);
    return handle(request, env, run);
  },
} satisfies ExportedHandler<Env>;

export async function handle(request: Request, env: Env, run: RunModel): Promise<Response> {
  const started = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const client = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await env.LIMITER.limit({ key: client });
    if (!success) return json({ error: 'rate_limited' }, 429);

    if (!env.APP_TOKEN) return json({ error: 'not_configured' }, 503);
    if (!(await hasToken(request, env.APP_TOKEN))) return json({ error: 'unauthorized' }, 401);

    if (path === '/v1/health' && request.method === 'GET') {
      return json({ ok: true, ai: true, model: env.AI_MODEL });
    }

    if (path === '/v1/extract' && request.method === 'POST') {
      const body = await readJson(request);
      if ('error' in body) return json({ error: body.error }, body.status);
      const text = isRecord(body.value) ? body.value.text : undefined;
      if (typeof text !== 'string' || !text.trim()) return json({ error: 'text_required' }, 400);

      const assignments = await extractAssignments(text, run);
      log('extract', { chars: text.length, found: assignments.length, ms: Date.now() - started });
      return json({ assignments });
    }

    return json({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof AiReadError) {
      log('ai_read_failed', { reason: error.message, ms: Date.now() - started });
      return json({ error: 'ai_read_failed' }, 502);
    }
    console.error(
      JSON.stringify({ msg: 'unhandled', path, error: error instanceof Error ? error.message : 'unknown' }),
    );
    return json({ error: 'internal_error' }, 500);
  }
}

/** Constant-time check: hash both to a fixed size first so length isn't leaked. */
async function hasToken(request: Request, expected: string): Promise<boolean> {
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return provided.length > 0 && crypto.subtle.timingSafeEqual(a, b);
}

type JsonBody = { value: unknown } | { error: string; status: number };

/** Reads a small JSON body, stopping as soon as it passes the size limit. */
async function readJson(request: Request): Promise<JsonBody> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return { error: 'too_large', status: 413 };
  if (!request.body) return { error: 'json_required', status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { error: 'too_large', status: 413 };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { error: 'json_required', status: 400 };
  }
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

function log(msg: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ msg, ...data }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
