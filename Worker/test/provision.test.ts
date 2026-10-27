import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index';
import * as writer from '../src/supabaseWriter';

vi.mock('../src/supabaseWriter', () => ({
  lookupProfileByAddress: vi.fn(),
  insertTransactions: vi.fn(),
  insertReviewRow: vi.fn(),
  setForwardAddress: vi.fn(),
  getForwardAddress: vi.fn(),
  getUserFromJwt: vi.fn(),
}));

const env = { SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k', INBOX_DOMAIN: 'expense-app.uk' } as never;

const post = (path = '/provision', auth: string | null = 'Bearer jwt') =>
  worker.fetch(
    new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: auth ? { Authorization: auth } : {},
    }),
    env,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(writer.getUserFromJwt).mockResolvedValue({ id: 'u1' });
  vi.mocked(writer.getForwardAddress).mockResolvedValue(null);
});

describe('POST /provision', () => {
  it('rejects a request with no bearer token', async () => {
    const res = await post('/provision', null);
    expect(res.status).toBe(401);
    expect(writer.setForwardAddress).not.toHaveBeenCalled();
  });

  it('mints and persists an address on the first call', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json() as { address: string; created: boolean };
    expect(body.address).toMatch(/^u_[0-9a-f]{16}@expense-app\.uk$/);
    expect(body.created).toBe(true);
    expect(writer.setForwardAddress).toHaveBeenCalledWith(env, 'u1', body.address);
  });

  // The bug: the setup screen calls /provision again on revisit. Re-minting
  // silently orphaned the Gmail filter already pointing at the old address —
  // mail to it stops matching a profile, so email() setRejects it and
  // forwarding dies with nothing visible in the app.
  it('returns the existing address and does not re-mint on a second call', async () => {
    vi.mocked(writer.getForwardAddress).mockResolvedValue('u_deadbeefdeadbeef@expense-app.uk');
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: 'u_deadbeefdeadbeef@expense-app.uk',
      created: false,
    });
    expect(writer.setForwardAddress).not.toHaveBeenCalled();
  });

  it('is stable across repeated calls', async () => {
    vi.mocked(writer.getForwardAddress).mockResolvedValue('u_stable0000000000@expense-app.uk');
    const a = await (await post()).json() as { address: string };
    const b = await (await post()).json() as { address: string };
    expect(a.address).toBe(b.address);
    expect(writer.setForwardAddress).not.toHaveBeenCalled();
  });

  it('mints a new address only when rotation is explicitly requested', async () => {
    const old = 'u_deadbeefdeadbeef@expense-app.uk';
    vi.mocked(writer.getForwardAddress).mockResolvedValue(old);
    const res = await post('/provision?rotate=1');
    const body = await res.json() as { address: string; created: boolean };
    expect(body.address).not.toBe(old);
    expect(body.address).toMatch(/^u_[0-9a-f]{16}@expense-app\.uk$/);
    expect(body.created).toBe(true);
    expect(writer.setForwardAddress).toHaveBeenCalledWith(env, 'u1', body.address);
  });

  it('does not even look up the address when rotating', async () => {
    await post('/provision?rotate=1');
    expect(writer.getForwardAddress).not.toHaveBeenCalled();
    expect(writer.setForwardAddress).toHaveBeenCalledOnce();
  });
});
