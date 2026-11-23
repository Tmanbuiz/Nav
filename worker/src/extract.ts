/**
 * Reads ride assignments from free text with a Workers AI model in JSON mode,
 * then cleans every field. Anything not plainly in the text comes back null:
 * the app shows these rides for review and never trusts them blindly.
 */

export interface AiAssignment {
  passengerName: string | null;
  phone: string | null;
  persons: number | null;
  serviceDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  transportType: 'pick-up' | 'two-way' | 'drop-off' | null;
  pickupAddress: string | null;
}

export interface ModelInput {
  messages: { role: 'system' | 'user'; content: string }[];
  response_format: { type: 'json_schema'; json_schema: unknown };
  max_tokens: number;
  temperature: number;
}

/** Runs the configured model. Injected so tests don't need a Cloudflare account. */
export type RunModel = (input: ModelInput) => Promise<unknown>;

export class AiReadError extends Error {}

const MAX_ASSIGNMENTS = 20;

const FIELD = { type: 'string' };
const SCHEMA = {
  type: 'object',
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          passengerName: FIELD,
          phone: FIELD,
          persons: { type: 'integer' },
          serviceDate: FIELD,
          windowStart: FIELD,
          windowEnd: FIELD,
          transportType: FIELD,
          pickupAddress: FIELD,
        },
        required: [
          'passengerName',
          'phone',
          'persons',
          'serviceDate',
          'windowStart',
          'windowEnd',
          'transportType',
          'pickupAddress',
        ],
      },
    },
  },
  required: ['assignments'],
};

const SYSTEM_PROMPT = `You read church transportation assignments from text messages and return JSON.
Return one entry per passenger who needs a ride. Copy values exactly as written.
Never guess or complete a value that is not in the text: use "" for missing text and 0 for missing persons.
serviceDate: YYYY-MM-DD, only when the full date is written in the text.
windowStart and windowEnd: 24-hour HH:MM. If only one time is given, use it for both.
transportType: "pick-up" (to church only), "two-way" (to church and back), "drop-off" (home from church only), or "" if unclear.
If the text has no ride assignment, return {"assignments": []}.`;

export async function extractAssignments(text: string, run: RunModel): Promise<AiAssignment[]> {
  let output: unknown;
  try {
    output = await run({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      max_tokens: 1500,
      temperature: 0,
    });
  } catch (error) {
    throw new AiReadError(error instanceof Error ? error.message : 'model call failed');
  }

  const body = readResponse(output);
  const list = isRecord(body) && Array.isArray(body.assignments) ? body.assignments : null;
  if (!list) throw new AiReadError('model returned an unexpected shape');
  return list.slice(0, MAX_ASSIGNMENTS).filter(isRecord).map(cleanAssignment).filter(hasAnything);
}

/** JSON mode returns `response` as an object or as a JSON string, sometimes fenced. */
function readResponse(output: unknown): unknown {
  const response = isRecord(output) && 'response' in output ? output.response : undefined;
  if (typeof response !== 'string') return response;
  const unfenced = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    throw new AiReadError('model returned text that is not JSON');
  }
}

export function cleanAssignment(raw: Record<string, unknown>): AiAssignment {
  const type = text(raw.transportType, 20)?.toLowerCase().replace(/\s+/g, '-');
  const persons = typeof raw.persons === 'number' ? raw.persons : Number(text(raw.persons, 3));
  return {
    passengerName: text(raw.passengerName, 120),
    phone: phone(raw.phone),
    persons: Number.isInteger(persons) && persons >= 1 && persons <= 20 ? persons : null,
    serviceDate: matching(raw.serviceDate, /^\d{4}-\d{2}-\d{2}$/),
    windowStart: matching(raw.windowStart, /^([01]\d|2[0-3]):[0-5]\d$/),
    windowEnd: matching(raw.windowEnd, /^([01]\d|2[0-3]):[0-5]\d$/),
    transportType: type === 'pick-up' || type === 'two-way' || type === 'drop-off' ? type : null,
    pickupAddress: text(raw.pickupAddress, 300),
  };
}

function hasAnything(a: AiAssignment): boolean {
  return Boolean(a.passengerName || a.phone || a.pickupAddress);
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function matching(v: unknown, pattern: RegExp): string | null {
  const s = text(v, 20);
  return s && pattern.test(s) ? s : null;
}

function phone(v: unknown): string | null {
  const s = text(v, 30);
  if (!s) return null;
  const kept = s.replace(/[^\d+]/g, '');
  return /\d{7,}/.test(kept) ? kept.slice(0, 16) : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
