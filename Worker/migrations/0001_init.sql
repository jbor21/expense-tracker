-- expense-inbox schema. Apply with:
--   npx wrangler d1 migrations apply expense-inbox --remote

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  address_token TEXT NOT NULL UNIQUE, -- local part of the inbox address ("u_<hex>")
  secret_hash TEXT NOT NULL UNIQUE,   -- sha256 hex of the bearer secret
  created_at INTEGER NOT NULL         -- epoch seconds
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- monotonic per-DB → the app's cursor
  user_id INTEGER NOT NULL REFERENCES users(id),
  orig_message_id TEXT,                 -- original Message-ID header (dedup key)
  from_addr TEXT NOT NULL,              -- original sender (TemplateRouter matches this)
  subject TEXT NOT NULL DEFAULT '',
  received_at INTEGER NOT NULL,         -- original Date header, epoch seconds
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL           -- arrival at the Worker (drives retention purge)
);

-- Re-forwarded duplicates are no-ops (NULL Message-IDs stay distinct per SQLite).
CREATE UNIQUE INDEX idx_messages_dedup ON messages (user_id, orig_message_id);
-- The /messages query path: per-user, newer-than-cursor, ordered.
CREATE INDEX idx_messages_user_cursor ON messages (user_id, id);
