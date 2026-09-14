# v0.8.1 — English GUI and documentation

- Translated all plugin-owned GUI labels, help text, confirmations, validation
  errors, accessibility labels, and configuration audit notes into English.
- Translated attachment-processing instructions and test fixtures into English.
- Translated the README, setup guide, installer guide, and release notes.
- Rebuilt the plugin and Channels UI bundles; included a complete English ZIP
  and updated SHA-256 checksums.
- Preserved channel IDs, account mappings, API references, and transport behavior.

**Requirements:** OpenClaw 2026.9.3 and Node.js 24+. Download the complete ZIP
for the plugin plus Channels GUI; the `.tgz` alone installs only the plugin.

Validation: type checking, build, 38 unit tests, and an English GUI browser fixture
covering add/edit/remove/last-account/read-only behavior with synthetic data.
The installer was checked on an isolated copy of the host. No production account
was changed or messaged. The known clean `npm ci` dependency limitation remains
listed in the README; no green CI is claimed.

OpenClaw's own interface language and agent reply language are outside this
plugin translation. The previous v0.8.0 artifacts remain available as historical
Portuguese-language builds. The maintainer's live installation was not updated
by publishing this release.
