import { afterEach, describe, expect, it, vi } from 'vitest';
import { Resend } from 'resend';

afterEach(() => vi.unstubAllGlobals());

describe('Resend SDK upgrade compatibility (all HTTP is mocked)', () => {
  it.each([
    { html: '<p>Generation completed</p>' },
    { text: 'Verify your sandbox account' },
  ])('preserves email payload and provider idempotency for %o', async content => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'email_test' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const client = new Resend('re_test_only');
    const payload = { from: 'sender@example.invalid', to: 'recipient@example.invalid', subject: 'Test', ...content };
    const result = await client.emails.send(payload, { idempotencyKey: 'test-once' });
    expect(result.error).toBeNull();
    expect(result.data?.id).toBe('email_test');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('test-once');
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('returns explicit send errors rather than inventing a successful receipt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      name: 'validation_error', message: 'Rejected',
    }), { status: 422 })));
    const result = await new Resend('re_test_only').emails.send({
      from: 'sender@example.invalid', to: 'recipient@example.invalid', subject: 'Test', text: 'Test',
    }, { idempotencyKey: 'test-rejected' });
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('Rejected');
  });
});
