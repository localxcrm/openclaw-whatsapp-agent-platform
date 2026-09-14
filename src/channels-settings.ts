import type { ControlUiAgent } from "openclaw/plugin-sdk/control-ui";
import { mountAccountManager, type AccountManagerHost } from "./control-ui.js";

type Client = { request: AccountManagerHost["request"] };

/** Local host adapter for the installed Channels page. No credentials are copied. */
export class WhatsAppChannelsSettings extends HTMLElement {
  private gatewayClient: Client | null = null;
  private admin = false;
  private mountedClient: Client | null = null;
  private mountedAdmin = false;
  private controller?: AbortController;
  private cleanup?: () => void;
  private pending = false;

  constructor() { super(); this.attachShadow({ mode: "open" }); }
  set client(value: Client | null) { this.gatewayClient = value; this.schedule(); }
  set canAdmin(value: boolean) { this.admin = value; this.schedule(); }
  connectedCallback() { this.schedule(); }
  disconnectedCallback() { this.dispose(); }

  private dispose() {
    this.controller?.abort();
    this.cleanup?.();
    this.cleanup = undefined;
    this.mountedClient = null;
    this.shadowRoot!.replaceChildren();
  }

  private schedule() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; this.mount(); });
  }

  private mount() {
    if (!this.isConnected) return;
    const client = this.gatewayClient;
    if (client === this.mountedClient && this.admin === this.mountedAdmin && this.controller && !this.controller.signal.aborted) return;
    this.dispose();
    if (!client) return;
    this.mountedClient = client;
    this.mountedAdmin = this.admin;
    const controller = new AbortController();
    this.controller = controller;
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = new URL("./whatsapp-channels-settings.css", import.meta.url).href;
    const container = document.createElement("div");
    this.shadowRoot!.append(style, container);
    let rows: ControlUiAgent[] = [];
    const host: AccountManagerHost = {
      signal: controller.signal,
      basePath: location.pathname.split("/settings/")[0],
      connection: { canAdmin: this.admin },
      request: async <T>(method: string, params?: Record<string, unknown>) => {
        if (controller.signal.aborted) throw new Error("Page disconnected.");
        const result = await client.request<T>(method, params);
        if (controller.signal.aborted) throw new Error("Page disconnected.");
        return result;
      },
      agents: {
        get rows() { return rows; },
        async refresh() {
          const result = await host.request<{ agents: ControlUiAgent[] }>("agents.list", {});
          rows = result.agents;
        },
      },
    };
    this.cleanup = mountAccountManager(container, host).dispose;
  }
}

if (!customElements.get("whatsapp-channels-settings")) {
  customElements.define("whatsapp-channels-settings", WhatsAppChannelsSettings);
}
