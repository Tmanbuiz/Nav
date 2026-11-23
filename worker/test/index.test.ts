// Runs inside the Workers runtime (workerd). Made-up riders only.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { cleanAssignment, type ModelInput } from '../src/extract';
import { handle } from '../src/index';

const TOKEN = 'test-token';
const AUTH = { authorization: `Bearer ${TOKEN}` };

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://churchride-ai.test${path}`, init);
}

function post(body: unknown, headers: Record<string, string> = AUTH): Request {
  return request('/v1/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** A stand-in model that returns a fixed response and records what it was asked. */
function fakeModel(response: unknown) {
  const calls: ModelInput[] = [];
  const run = async (input: ModelInput) => {
    calls.push(input);
    return { response };
  };
  return { run, calls };
}

const neverCalled = async (): Promise<unknown> => {
  throw new Error('model should not be called');
};

describe('auth', () => {
  it('rejects a missing or wrong token without calling the model', async () => {
    expect((await handle(request('/v1/health'), env, neverCalled)).status).toBe(401);
    const wrong = await handle(request('/v1/health', { headers: { authorization: 'Bearer nope' } }), env, neverCalled);
    expect(wrong.status).toBe(401);
    const empty = await handle(request('/v1/health', { headers: { authorization: 'Bearer ' } }), env, neverCalled);
    expect(empty.status).toBe(401);
  });

  it('answers health with the right token', async () => {
    const res = await handle(request('/v1/health', { headers: AUTH }), env, neverCalled);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ai: true, model: env.AI_MODEL });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses everything when APP_TOKEN is not set', async () => {
    const res = await handle(request('/v1/health', { headers: AUTH }), { ...env, APP_TOKEN: '' }, neverCalled);
    expect(res.status).toBe(503);
  });
});

describe('extract', () => {
  it('sends the text in JSON mode and returns cleaned assignments', async () => {
    const model = fakeModel(
      JSON.stringify({
        assignments: [
          {
            passengerName: '  Jane   Example ',
            phone: '(506) 555-0101',
            persons: 2,
            serviceDate: '2099-11-29',
            windowStart: '09:30',
            windowEnd: '09:45',
            transportType: 'Two Way',
            pickupAddress: '100 Example Street, Fredericton, NB',
          },
        ],
      }),
    );
    const res = await handle(post({ text: 'Pick up Jane at 9:30 on Nov 29...' }), env, model.run);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      assignments: [
        {
          passengerName: 'Jane Example',
          phone: '5065550101',
          persons: 2,
          serviceDate: '2099-11-29',
          windowStart: '09:30',
          windowEnd: '09:45',
          transportType: 'two-way',
          pickupAddress: '100 Example Street, Fredericton, NB',
        },
      ],
    });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.response_format.type).toBe('json_schema');
    expect(model.calls[0]?.temperature).toBe(0);
    expect(model.calls[0]?.messages[1]).toEqual({ role: 'user', content: 'Pick up Jane at 9:30 on Nov 29...' });
  });

  it('accepts an object response and a fenced JSON string', async () => {
    const asObject = fakeModel({ assignments: [{ passengerName: 'Ann Sample', persons: 1 }] });
    const res1 = await handle(post({ text: 'x' }), env, asObject.run);
    expect(((await res1.json()) as { assignments: unknown[] }).assignments).toHaveLength(1);

    const fenced = fakeModel('```json\n{"assignments": [{"passengerName": "Ben Sample"}]}\n```');
    const res2 = await handle(post({ text: 'x' }), env, fenced.run);
    expect(((await res2.json()) as { assignments: { passengerName: string }[] }).assignments[0]?.passengerName).toBe(
      'Ben Sample',
    );
  });

  it('turns guesses and junk into nulls, and drops empty entries', () => {
    expect(
      cleanAssignment({
        passengerName: '',
        phone: 'call me',
        persons: 0,
        serviceDate: 'Sunday',
        windowStart: '9:30 AM',
        windowEnd: '25:00',
        transportType: 'boat',
        pickupAddress: '   ',
      }),
    ).toEqual({
      passengerName: null,
      phone: null,
      persons: null,
      serviceDate: null,
      windowStart: null,
      windowEnd: null,
      transportType: null,
      pickupAddress: null,
    });
  });

  it('returns an empty list when the text has no ride', async () => {
    const res = await handle(post({ text: 'See you Sunday!' }), env, fakeModel({ assignments: [] }).run);
    expect(await res.json()).toEqual({ assignments: [] });
  });

  it('reports a model failure as 502, not a crash', async () => {
    const failing = async (): Promise<unknown> => {
      throw new Error("JSON Mode couldn't be met");
    };
    expect((await handle(post({ text: 'x' }), env, failing)).status).toBe(502);
    expect((await handle(post({ text: 'x' }), env, fakeModel('not json at all').run)).status).toBe(502);
    expect((await handle(post({ text: 'x' }), env, fakeModel({ nope: true }).run)).status).toBe(502);
  });
});

describe('request checks', () => {
  it('rejects bad JSON, missing text and oversized bodies', async () => {
    expect((await handle(post('{not json'), env, neverCalled)).status).toBe(400);
    expect((await handle(post({ text: '   ' }), env, neverCalled)).status).toBe(400);
    expect((await handle(post({ text: 'x'.repeat(20_000) }), env, neverCalled)).status).toBe(413);
  });

  it('404s unknown routes and wrong methods', async () => {
    expect((await handle(request('/nope', { headers: AUTH }), env, neverCalled)).status).toBe(404);
    expect((await handle(request('/v1/extract', { headers: AUTH }), env, neverCalled)).status).toBe(404);
  });
});
