# v0.8.0 — WhatsApp Agent Platform GUI

Initial public release of the approved distribution.

- Account manager inside WhatsApp Agent Platform details in Settings → Channels.
- Map an existing agent to a protected vault API reference.
- Change the assigned agent, session mode, and enabled state.
- Remove mappings without deleting agents.
- Compatibility-checked installer and versioned assets for stale browser caches.
- TypeScript source, tests, MIT license, and setup/usage documentation.

**GUI requirement: OpenClaw 2026.9.3 + Node.js 24+.** Install the complete ZIP;
the `.tgz` alone does not install the Channels integration.

This historical release contains the original Portuguese GUI and package docs.
For the English interface and documentation, use **v0.8.1 or newer**. Historical
v0.8.0 binaries are preserved rather than silently replaced.

Validation: 38 tests, type checking, and builds with local dependencies; browser
fixtures with synthetic data and a warm cache; installer on an isolated host copy.
A clean development dependency install was blocked by unavailable
`iconv-lite@~0.8.0`; no green CI or second-computer deployment is claimed.
