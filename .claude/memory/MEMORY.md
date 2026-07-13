# TendTo project memory — index

One line per memory. Full content in the linked files; keep this index lean.

- [Architecture decision: sync-engine local-first](architecture-decision.md) — why PowerSync over cloud-first and over Yjs; the exit ramps
- [Naming & domain](naming-and-domain.md) — TendTo; tendto.app taken, expiry watch Nov 2026; interim domain candidates
- [Settled stack decisions](settled-decisions.md) — do-not-relitigate list with one-line whys
- [Auth & sync redesign](auth-and-sync-redesign.md) — Clerk → better-auth (scale pricing); PowerSync kept (only engine passing offline); JWKS wiring
- [Phase 1 build](phase-1-build.md) — what shipped in the MVP; block-id=BlockNote string, /bootstrap chicken/egg, cross-tenant pin, editor hydrate/persist, pinned web versions
- [Desktop shell plan](desktop-shell-plan.md) — Rust via Tauri 2 + first-party PowerSync Tauri plugin (alpha); never @powersync/web in a webview; WebKitGTK is the risk
