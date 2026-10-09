import { describe, expect, it } from 'vitest';
import { errorCode, friendlyError, isRetryable, withRetry } from '../src/extraction/gemini';

// The exact shape of the message you saw on screen.
const busy = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
const gone = new Error('{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available","status":"NOT_FOUND"}}');
const noSleep = async () => {};

describe('Gemini error handling', () => {
  it('reads the status code from the SDK error text or fields', () => {
    expect(errorCode(busy)).toBe(503);
    expect(errorCode(gone)).toBe(404);
    expect(errorCode({ status: 429 })).toBe(429);
    expect(errorCode(new Error('boom'))).toBeNull();
  });

  it('only treats temporary failures as retryable', () => {
    expect(isRetryable(busy)).toBe(true);
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable(gone)).toBe(false);
    expect(isRetryable({ status: 403 })).toBe(false);
  });

  it('retries a busy model and then succeeds', async () => {
    let calls = 0;
    const out = await withRetry(async () => { if (++calls < 3) throw busy; return 'ok'; }, [1, 1, 1], noSleep);
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after the last delay and rethrows', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw busy; }, [1, 1], noSleep)).rejects.toBe(busy);
    expect(calls).toBe(3); // first try + 2 retries
  });

  it('does not retry errors that retrying cannot fix', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw gone; }, [1, 1, 1], noSleep)).rejects.toBe(gone);
    expect(calls).toBe(1);
  });

  it('shows short, plain messages instead of raw JSON', () => {
    expect(friendlyError('a.pdf', busy, ['m'])).toMatch(/busy or rate limited/);
    expect(friendlyError('a.pdf', gone, ['m1', 'm2'])).toMatch(/npm run models/);
    expect(friendlyError('a.pdf', { status: 403 }, ['m'])).toMatch(/GEMINI_API_KEY/);
  });
});