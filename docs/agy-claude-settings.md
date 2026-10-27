# agy ↔ Claude collaboration settings

**What this is:** the menu of choices that control how Claude (me) and Gemini (agy)
work together on a task — the two-agent "talk to each other, produce the best output"
loop. These are **not** stored in any config file; they're just modes you tell Claude.

**How to change:** paste your two picks in a message, e.g.
`① Writing / analysis / research  ② Loop until it converges` — Claude switches to that mode.

**When Claude should read this:** whenever the user asks to change how agy/Claude
collaborate, mentions "the two settings", "the loop", "agy modes", or references
the collaboration options.

---

## ① What should the two agents work on? (task type)

- **Code in this repo** — write/refactor/review code in this app; Gemini and Claude
  cross-check each other's work before it lands.
- **Writing / analysis / research** — a doc, plan, or research answer; drafted by one
  model, critiqued by the other, refined to convergence.
- **A design / brainstorm** — explore an idea from two independent model perspectives,
  then synthesize the best combined version.
- **Just show me a demo** — one small throwaway Claude↔Gemini round-trip to see the
  mechanics.

## ② How much back-and-forth? (loop depth)

- **One round + reconcile** — one model drafts, the other critiques once, Claude merges
  the best of both. Fast, cheap, usually enough.
- **Loop until it converges** — keep passing it back and forth until neither model finds
  real improvements. Higher quality, more tokens/time.
- **Full multi-agent workflow** — spawn several agents in parallel, cross-verify,
  synthesize a winner. Heaviest; only for big/thorough jobs.

---

## Current picks

- ① **Code in this repo**
- ② **One round + reconcile**

## Related knobs (separate from the two above)

- **Per-task model tier:** `agy-delegate --tier flash-lo|flash|pro "<task>"`, or just say
  "use the cheap/pro tier". Default reasoning model is Gemini 3.1 Pro (High).
- **Persistent default model:** the `"model"` field in
  `~/.gemini/antigravity-cli/settings.json`.
- **Trigger the loop:** give Claude a task and add "cross-check with Gemini" /
  "one round with agy".
