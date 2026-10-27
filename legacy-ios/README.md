# legacy-ios — dormant native app (not built by CI)

This tree is the original **local-first iOS** version of Tally: the SwiftUI app
(`App/`) and the `ExpenseKit` Swift package (`Packages/ExpenseKit/`).

## Status: incomplete / not the live product

The live product is the **PWA** (`web/` + `Worker/` + Supabase). It replaced the
on-device Gmail-OAuth ingestion path in July 2026 (see the root `CLAUDE.md`
history and `docs/`).

This copy was **truncated by an iCloud "Desktop & Documents" sync accident** in
Sept 2026 that corrupted the git object store and deleted files from disk. What's
missing here:

- `Packages/ExpenseKit/Sources/Email/` — the entire `Email` target
  (`EmailSource`, `GmailSource`, `GraphSource`, `ForwardedInboxSource`,
  `IngestionPipeline`, `ChargeParser`, HTTP/token seams, onboarding).
- `Packages/ExpenseKit/Sources/Parsing/Templates/FidelityTemplate.swift`.
- `Packages/ExpenseKit/Tests/EmailTests/` and `.../ParsingTests/FidelityTemplateTests.swift`
  (test file present, subject missing).

`Package.swift` still references the `Email` target, so **this package does not
build as-is**.

## Recovery

A complete, building copy exists on the original Mac (offline as of Sept 2026).
If it comes back online: `git push` its history to this GitHub repo on a branch,
then reconcile. The parsing / crypto logic also survives in TypeScript form under
`Worker/src/parsing/` and `Worker/src/crypto.ts` if a from-scratch rebuild is
ever wanted.

Until then this directory is kept only as a reference and is excluded from all
CI workflows.
