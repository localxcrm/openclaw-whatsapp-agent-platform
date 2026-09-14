# WhatsApp Agent Platform — English distribution 0.8.1

Includes the plugin and its account-management GUI. Open
**Settings → Channels → WhatsApp Agent Platform** to manage mappings.
The manager does not appear on the Channels overview.

List existing agents, add/edit/remove account mappings, and select API references
from the protected vault. Removing a mapping does not delete the agent.
No real accounts, credentials, conversations, backups, or runtime state are included.

## Compatibility

Node.js >=24. The GUI integration targets **OpenClaw 2026.9.3** and checks the
host asset layout. It is not an official SDK extension slot. Host updates may
replace it; other versions require adaptation. Installing only the `.tgz` does
not install the Channels integration. This project is distributed through GitHub
Releases; no npm publication is assumed.

## Installation

Extract the ZIP. Supply the installed OpenClaw package directory containing
`package.json`, `openclaw.mjs`, and `dist/`, not the `~/.openclaw` configuration folder.

```sh
node install.mjs /path/to/node_modules/openclaw --check
node install.mjs /path/to/node_modules/openclaw
```

The first command only checks compatibility. The second uses the official CLI
to install the plugin and applies the GUI with versioned URLs. If the correct
plugin version is already installed, use `--ui-only` to apply only the GUI.
Restart the Gateway through its usual lifecycle and reload the page.
Each installation must configure its own agents and APIs.

Enable the plugin with `transport: "channel"` and an `accounts` map. Follow the
[setup and usage guide](https://github.com/localxcrm/openclaw-whatsapp-agent-platform/blob/main/docs/CONFIGURATION.md).
Preserve existing accounts and vault references when upgrading.

## Rollback

The GUI installer backs up existing `index.html`, `index.html.gz`, and
`index.html.br` files under `ui/backups/cache-fix-<timestamp>`. Restore these
files to OpenClaw's `dist/control-ui` directory and reload to undo the GUI
integration. Keep backups until operation is confirmed. This does not uninstall
the transport plugin. Unreferenced versioned assets may remain.

## Validation

Type checking, builds, and 38 unit tests run with existing local dependencies.
The English GUI browser fixture exercises add, edit, remove, last-account removal,
and read-only access with synthetic accounts. The original host integration was
also tested with a warm cache and on an isolated copy of the host assets.
These checks do not claim authenticated end-to-end testing on a second computer.
See the repository README for the known `npm ci` clean-build limitation.
