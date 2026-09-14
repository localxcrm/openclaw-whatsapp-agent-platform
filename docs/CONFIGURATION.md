# Setup and usage

## 1. Prepare OpenClaw and WhatsApp

Use OpenClaw **2026.9.3**, Node.js 24+, and administrator access to the Control UI.
Create your OpenClaw agents first and configure their models and workspaces.
The GUI selects existing agents; it does not create or delete OpenClaw agents.

You need a credential issued specifically for **WhatsApp Agent Platform**.
This code uses `https://api.whatsapp.com/agent/v1`; it is neither the WhatsApp Web
QR channel nor a WhatsApp Business Cloud API integration. Follow the official
flow available to your WhatsApp account. Installing this plugin does not grant
platform access or generate a Meta credential. A public credential-issuance
portal has not been verified for this release.

## 2. Install the plugin and GUI

Download the complete ZIP from the [latest release](https://github.com/localxcrm/openclaw-whatsapp-agent-platform/releases/latest)
and extract it. Open a terminal in the extracted folder. Supply the directory
of the **installed OpenClaw package**, containing `package.json`, `openclaw.mjs`,
and `dist/`. Do not use your workspace or the `~/.openclaw` configuration folder.

```sh
node install.mjs /path/to/node_modules/openclaw --check
node install.mjs /path/to/node_modules/openclaw
```

If you cloned the repository, run these commands from `distribution/`.
Do not invoke the internal `ui/` scripts directly. For global npm installations,
`npm root -g` can help locate the package; other managers may use another path.

`--check` only verifies compatibility. The installer uses OpenClaw's CLI to
install the plugin, then adds the GUI with versioned assets. To install only the
GUI when the correct plugin version is already installed, use `--ui-only`.
Installing the `.tgz` alone does not integrate the Channels screen.

## 3. Enable the native transport

The internal plugin ID is `whatsapp-agent-admin` for historical compatibility.
The channel ID is `whatsapp-agent`. In OpenClaw's plugin configuration, enable
the plugin and set `transport: "channel"` at the root of its configuration.

For a fresh installation, the initial plugin entry is:

```json
{
  "enabled": true,
  "config": {
    "transport": "channel",
    "accounts": {}
  }
}
```

This object belongs at `plugins.entries.whatsapp-agent-admin`; it is not a
complete configuration file. Use OpenClaw's configuration editor.
**For existing installations, preserve `accounts`, vault references, and state;
do not replace existing accounts with the empty example.** The code defaults
to `legacy`; explicitly select `channel` for this workflow.

Restart through OpenClaw's normal lifecycle. With the CLI:

```sh
openclaw gateway restart
openclaw gateway health
```

## 4. Add an account through the GUI

1. Open **Settings → Channels → WhatsApp Agent Platform**.
2. Click **+ Add agent**.
3. Enter a unique **Account name**, such as `support`. Use lowercase letters,
   numbers, `_`, or `-`, starting with a letter.
4. Under **Existing agent**, select the agent that should respond.
5. Click **Save API in the protected vault**. Create a vault secret such as
   `WHATSAPP_AGENT_SUPPORT_TOKEN`, enter its credential only in the protected
   field, and allow the host `api.whatsapp.com`.
6. Return to the form, click **Refresh APIs**, select the secret, and click
   **Add mapping**.

The GUI lists secret names/references, not token values. Each installation uses
its own credentials. References already assigned to named accounts are not
offered for new accounts. Do not run another poller with the same credential.

## 5. Edit, disable, or remove a mapping

- **Change agent:** choose another **Assigned agent**, then click **Save mapping**.
- **Session:** choose **Agent main session** or **Isolated per contact**, then save.
  The main session shares context; isolated sessions separate contacts.
- **Disable:** clear **Account enabled** and save.
- **Remove:** click **Remove mapping** and confirm. This removes the plugin
  account, not the agent, history, or vault secret. Removing the last account
  is supported.

Adding/removing may be unavailable for legacy single-account configuration.
Migrate to the `accounts` map while preserving data and references before using
that workflow.

## 6. Test the connection

Through WhatsApp's official flow, open the conversation for the agent associated
with your credential and send a test message. Verify both receipt and response.
A "running" status alone does not prove end-to-end delivery. Test media separately.
The GUI does not provide bulk messaging, group management, or Meta agent creation.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Only status and advanced settings appear | Install the complete distribution, not just the `.tgz`; reload and open the plugin details. |
| Version rejected | The GUI is validated for 2026.9.3; do not force the patch onto another version. |
| Agent missing | Create it in OpenClaw, check permissions, and refresh the list. |
| API missing | Save it in the vault, click Refresh APIs, and check whether its reference is already in use. |
| Cannot save | Check admin permissions, save/discard pending native configuration edits, and refresh after conflicts. |
| No reply | Check channel transport, enabled state, platform access, credential, model, and Gateway health. |
| Some host labels are not in English | OpenClaw controls its own language. This release translates plugin-owned text, not the host application. |

To undo only the GUI, restore the `index.html*` files backed up under
`ui/backups/cache-fix-*` into the host's `dist/control-ui` directory. OpenClaw
updates may replace the integration and require revalidation.
