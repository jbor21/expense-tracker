// expense-inbox — inbound-email parser for Tally (the Expense Tracker PWA).
//
// Cloudflare Email Routing delivers mail sent to a per-user address here; the
// Worker parses it with the bank templates and writes rows straight into
// Supabase. The PWA never sees raw email.
//
// Routes:
//   POST /provision           Bearer <token> → { address, created }
//                             idempotent; returns the existing address if any
//   POST /provision?rotate=1  Bearer <token> → { address, created: true }
//                             explicitly mints a new address (breaks old filters)
//
// The old store-and-forward surface (/messages, /ack, D1) is retired — the
// app reads Supabase directly.

import PostalMime from 'postal-mime';
import { stripHtml } from './parsing/htmlStripper';
import { routeAndParse } from './parsing/templates';
import {
  getForwardAddress, getUserFromJwt, insertReviewRow, insertTransactions,
  lookupProfileByAddress, setForwardAddress, type SupabaseEnv,
} from './supabaseWriter';

export interface Env extends SupabaseEnv {
  INBOX_DOMAIN: string;
}

const EXCERPT_CHARS = 500;

// The PWA calls /provision cross-origin; without these headers the browser
// silently blocks the request (the button "does nothing").
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://tally.expense-app.uk',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });

function bearer(request: Request): string | null {
  const h = request.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface InboundMsg {
  to: string;
  from: string;
  subject: string;
  messageId: string | null;
  date: Date;
  text: string;
  html: string;
}

export async function handleInboundEmail(
  env: Env, msg: InboundMsg,
): Promise<'stored' | 'review' | 'rejected'> {
  const profile = await lookupProfileByAddress(env, msg.to.toLowerCase());
  if (!profile) return 'rejected';

  const text = msg.text.trim() !== '' ? msg.text : stripHtml(msg.html);
  const messageId = msg.messageId ?? `${msg.to}:${msg.date.toISOString()}:${msg.subject}`;
  const charges = routeAndParse(
    { messageId, from: msg.from, subject: msg.subject, receivedAt: msg.date, text },
    profile.email,
  );

  if (charges === null || charges.length === 0) {
    // Unknown sender, or a known sender with no anchored amount line —
    // never guess, never drop silently.
    await insertReviewRow(env, profile.id, {
      sender: msg.from,
      subject: msg.subject,
      excerpt: text.slice(0, EXCERPT_CHARS),
      receivedAt: msg.date,
    }, profile.public_key);
    return 'review';
  }

  await insertTransactions(env, profile.id, messageId, charges, profile.public_key);
  return 'stored';
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const parsed = await PostalMime.parse(message.raw);
    const date = parsed.date ? new Date(parsed.date) : new Date();
    const outcome = await handleInboundEmail(env, {
      to: message.to,
      // Gmail filter-forwarding preserves the original From — the sender the
      // templates match on.
      from: parsed.from?.address ?? message.from,
      subject: parsed.subject ?? '',
      messageId: parsed.messageId ?? null,
      date: Number.isNaN(date.getTime()) ? new Date() : date,
      text: parsed.text ?? '',
      html: parsed.html ?? '',
    });
    // Reject unknown recipients so a typo'd forwarding address fails visibly
    // in Gmail instead of silently swallowing mail.
    if (outcome === 'rejected') message.setReject('No such recipient');
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === 'POST' && url.pathname === '/provision') {
      const jwt = bearer(request);
      const user = jwt ? await getUserFromJwt(env, jwt) : null;
      if (!user) return json({ error: 'unauthorized' }, 401);

      // Idempotent by default. Minting a fresh address on every call silently
      // orphaned any Gmail filter already pointing at the previous one: mail to
      // the old address no longer matches a profile, so email() setRejects it
      // and the user's forwarding dies with no visible cause in the app. The
      // setup screen calls this on mount, so a revisit was enough to break it.
      // Rotation is now an explicit, opt-in act.
      if (url.searchParams.get('rotate') !== '1') {
        const existing = await getForwardAddress(env, user.id);
        if (existing) return json({ address: existing, created: false });
      }

      const address = `u_${randomHex(8)}@${env.INBOX_DOMAIN}`;
      await setForwardAddress(env, user.id, address);
      return json({ address, created: true });
    }

    return json({ error: 'not found' }, 404);
  },
};
