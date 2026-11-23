/**
 * Client for the ChurchRide Cloudflare Worker (see /worker). Used only when the
 * on-device parser can't read a text. Results always go to review.
 */
import type { AiRide } from '@/core/validate';
import type { Settings } from '@/db/settings';

export function aiConfigured(settings: Settings): boolean {
  return /^https:\/\//.test(settings.aiUrl.trim()) && settings.aiToken.trim().length > 0;
}

function endpoint(settings: Settings, path: string): string {
  return `${settings.aiUrl.trim().replace(/\/+$/, '')}${path}`;
}

export async function checkAi(settings: Settings): Promise<{ ok: boolean; message: string }> {
  if (!aiConfigured(settings)) return { ok: false, message: 'Add the Worker URL and token first.' };
  try {
    const res = await fetch(endpoint(settings, '/v1/health'), {
      headers: { authorization: `Bearer ${settings.aiToken.trim()}` },
    });
    if (res.status === 401) return { ok: false, message: 'The Worker rejected the token.' };
    if (!res.ok) return { ok: false, message: `The Worker answered ${res.status}.` };
    const body = (await res.json()) as { ai?: boolean };
    return body.ai
      ? { ok: true, message: 'Connected. AI reading is ready.' }
      : { ok: false, message: 'Connected, but the Worker has no AI key set yet.' };
  } catch {
    return { ok: false, message: 'Couldn’t reach the Worker. Check the URL.' };
  }
}

export async function extractWithAi(text: string, settings: Settings): Promise<AiRide[]> {
  const res = await fetch(endpoint(settings, '/v1/extract'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.aiToken.trim()}`,
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI reading failed (${res.status}). ${detail.slice(0, 200)}`);
  }
  const body = (await res.json()) as { assignments?: unknown };
  return Array.isArray(body.assignments) ? (body.assignments as AiRide[]) : [];
}
