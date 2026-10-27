# Tally — Privacy & Encryption

*How your financial data is protected, in plain English. Last updated July 2026.*

## The short version

**Your spending data is end-to-end encrypted. The person who runs Tally cannot see your merchants, amounts, or card numbers — even if they wanted to, even by looking directly at the database.**

When you first log in, the app generates a secret key that exists only on your device, shown to you as 12 words. Everything sensitive is locked with that key before it's stored. The server only ever holds scrambled ciphertext it cannot open.

## How it works

1. **Your key is born on your device.** At signup the app generates a random secret and shows it to you as a 12-word recovery phrase. Those words *are* your key — the server never sees them and they never leave your device.

2. **Your device shares only a "lock", never the key.** From your secret, the app derives a matching public key (think of it as an open padlock) and uploads that. A public key can only *lock* data for you — it can never unlock it.

3. **Charges are locked before they're stored.** When a bank alert email arrives, the relay parses out the charge, immediately seals the sensitive parts (merchant, amount, card last-4, purchase/refund) with your padlock, and stores only the sealed blob. The database row for a $14.50 Chipotle charge looks like `eyJ2IjoxLCJlcGsiOiJ...` — meaningless without your 12 words.

4. **Only your device can unlock it.** When you open the app, it uses the key stored on your device to decrypt your charges locally, in your browser. Decrypted data never goes back to the server.

## What this means in practice

| | Can your device see it? | Can the operator see it? |
|---|---|---|
| Merchant names | ✅ | ❌ ciphertext only |
| Amounts | ✅ | ❌ ciphertext only |
| Card last-4 digits | ✅ | ❌ ciphertext only |
| Purchase vs. refund | ✅ | ❌ ciphertext only |
| Your budget amounts | ✅ | ❌ ciphertext only |
| Emails needing review (sender/subject/excerpt) | ✅ | ❌ ciphertext only |

A few things stay unencrypted so the app can work (and it's fair you know exactly what):

- **When charges happened** (timestamps) — needed to group charges by month.
- **Your category names and which category each charge is in** — e.g. the operator could see you have a category called "Dining" with 6 charges this month, but not where you ate, what you spent, or what your Dining budget is.
- **Your email address and your Tally forwarding address.**

## The honest fine print

No system is magic. Here's exactly what you're still trusting:

- **The moment of arrival.** Your bank's alert email passes through the relay in plaintext for the few milliseconds it takes to parse and encrypt it. It is never written down unencrypted — but a maliciously modified relay *could* read emails as they arrive. What E2EE guarantees is that everything *stored* — your entire history — is unreadable. (Also worth knowing: bank alert emails are ordinary email, which was never encrypted end-to-end to begin with.)
- **The app code.** Your browser runs code served by the operator. This is true of every web app with E2EE (WhatsApp Web, Proton Mail, etc.). The code is open for inspection.
- **Your own device.** Your key lives in your browser's storage. Anyone with your unlocked phone or laptop can open the app, same as any app you stay signed into.

What's ruled out: the operator reading your history out of the database, a database leak exposing your spending, or Supabase (the database host) seeing anything sensitive.

## Your 12 words — read this part

Because the operator can't read your data, **they also can't recover it for you.** There is no "forgot my key" reset.

- **Save your 12-word phrase somewhere safe** (screenshot it, put it in your password manager or notes).
- Getting a new phone or clearing your browser data? Just log in and type the 12 words — your full history unlocks.
- **Lose the words while also losing your device = your encrypted history is gone forever.** Nobody can bring it back. That's not a bug; it's the proof that nobody else holds a key.

---

## Technical appendix

For the curious. All crypto code is a single shared implementation (`Worker/src/crypto.ts`) used by both the relay and the web app, built on the audited [`@noble/curves`](https://github.com/paulmillr/noble-curves) and [`@scure/bip39`](https://github.com/paulmillr/scure-bip39) libraries plus the browser's native WebCrypto for AES.

**Key derivation.** Signup generates 128 bits of entropy, rendered as a 12-word BIP39 mnemonic (English wordlist). The X25519 private key is `SHA-256(entropy)`; the corresponding public key (base64) is uploaded to `profiles.public_key`. The entropy is stored as hex in the browser's `localStorage`, so keys are deterministically rebuilt from the phrase on any device.

**Sealed box.** Each row is encrypted with an ECIES-style construction:

```
ephemeral   = fresh X25519 keypair per message
shared      = X25519(ephemeral_private, recipient_public)
aes_key     = HKDF-SHA256(shared, info = "tally-e2ee-v1" || ephemeral_pub || recipient_pub, 32 bytes)
ciphertext  = AES-256-GCM(aes_key, iv = 12 random bytes, plaintext = JSON payload)
blob        = base64({ v: 1, epk, iv, ct })
```

Binding both public keys into the HKDF `info` ties the AES key to the exact sender/recipient pair. A fresh ephemeral key per message means no two blobs share key material. The relay holds only ephemeral private keys it discards immediately after sealing — it cannot decrypt what it just wrote.

**Encrypted payloads.** Transactions: `{ merchant, amountCents, kind, accountLast4 }` → `transactions.payload_enc`. Review-queue items: `{ sender, subject, excerpt }` → `review_queue.payload_enc`. Budgets: `{ amountCents }` → `budgets.payload_enc` (budgets never pass through the relay — the app seals them with the user's own public key at save). Legacy plaintext columns are nullable and left null for new rows; existing pre-E2EE history is encrypted client-side (and plaintext nulled) on the user's first post-E2EE login, with an idempotent sweep on every app load catching stragglers.

**Deliberately plaintext** (query/servability trade-offs): `occurred_at` (month bucketing), `category_id` + category names (grouping), `message_id`/`line_idx` (server-side dedup so re-forwarded emails don't double-count), profile email + forwarding address.

**Threat model.** Protects against: a curious or compelled operator reading stored data, database compromise, and hosting-provider access. Does not protect against: a malicious *relay or app build* (code is served, not verified — the standard web-E2EE caveat), compromise of the user's own device, or interception of email before it reaches the relay. Plaintext email transit through the relay at ingest (parse → seal, never persisted) is the accepted residual exposure.
