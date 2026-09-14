// node_modules/openclaw/dist/plugin-sdk/control-ui.js
function defineControlUiPlugin(plugin) {
  return plugin;
}

// src/control-ui-model.ts
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function readAccountRoutes(config) {
  const root = asRecord(config);
  const plugins = asRecord(root?.plugins);
  const entries = asRecord(plugins?.entries);
  const plugin = asRecord(entries?.["whatsapp-agent-admin"]);
  const pluginConfig = asRecord(plugin?.config);
  const accounts = asRecord(pluginConfig?.accounts);
  if (accounts) {
    return Object.entries(accounts).flatMap(([accountId, value]) => {
      const account = asRecord(value);
      if (!account) return [];
      return [{
        accountId,
        agentId: typeof account.agentId === "string" ? account.agentId : "",
        enabled: account.enabled !== false,
        sessionMode: account.sessionMode === "main" ? "main" : "isolated"
      }];
    }).sort((left, right) => left.accountId.localeCompare(right.accountId));
  }
  if (!pluginConfig) return [];
  return [{
    accountId: "default",
    agentId: typeof pluginConfig.agentId === "string" ? pluginConfig.agentId : "main",
    enabled: true,
    sessionMode: pluginConfig.sessionMode === "main" ? "main" : "isolated"
  }];
}
function buildAccountRoutePatch(route, hasAccounts) {
  const routePatch = {
    agentId: route.agentId,
    enabled: route.enabled,
    sessionMode: route.sessionMode
  };
  return {
    plugins: {
      entries: {
        "whatsapp-agent-admin": {
          config: hasAccounts ? { accounts: { [route.accountId]: routePatch } } : routePatch
        }
      }
    }
  };
}
function hasAccountMap(config) {
  const root = asRecord(config);
  return Boolean(asRecord(asRecord(asRecord(asRecord(asRecord(root?.plugins)?.entries)?.["whatsapp-agent-admin"])?.config)?.accounts));
}
function buildAccountMutation(accountId, account) {
  if (!/^[a-z][a-z0-9_-]*$/.test(accountId) || ["constructor", "prototype", "__proto__"].includes(accountId)) {
    throw new Error("Use um identificador com letras min\xFAsculas, n\xFAmeros, h\xEDfen ou sublinhado.");
  }
  return { plugins: { entries: { "whatsapp-agent-admin": { config: { accounts: { [accountId]: account } } } } } };
}
function buildNewAccountPatch(accountId, agentId, secretName, existingIds) {
  if (existingIds.includes(accountId)) throw new Error("J\xE1 existe uma conta com esse identificador.");
  if (!/^[a-z][a-z0-9_-]*$/.test(agentId)) throw new Error("Selecione um agente v\xE1lido.");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(secretName)) throw new Error("Selecione a API no cofre protegido.");
  return buildAccountMutation(accountId, { agentId, apiToken: { source: "store", provider: "default", id: secretName }, enabled: true, sessionMode: "isolated" });
}
function usedStoreSecrets(config) {
  const root = asRecord(config);
  const cfg = asRecord(asRecord(asRecord(asRecord(root?.plugins)?.entries)?.["whatsapp-agent-admin"])?.config);
  const accounts = asRecord(cfg?.accounts);
  return Object.values(accounts ?? {}).flatMap((value) => {
    const token = asRecord(asRecord(value)?.apiToken);
    return token?.source === "store" && typeof token.id === "string" ? [token.id] : [];
  });
}

// src/control-ui.ts
function agentLabel(agent) {
  const identity = agent.identity;
  return identity?.name?.trim() || agent.name?.trim() || agent.id;
}
function routeCard(host, route, hasAccounts, hash, reload) {
  const card = document.createElement("article");
  card.className = "wa-agent-route-card";
  const title = document.createElement("h2");
  title.textContent = route.accountId;
  const grid = document.createElement("div");
  grid.className = "wa-agent-route-grid";
  const agentField = document.createElement("label");
  agentField.textContent = "Agente respons\xE1vel";
  const agentSelect = document.createElement("select");
  agentSelect.setAttribute("aria-label", `Agente da conta ${route.accountId}`);
  for (const agent of host.agents.rows.filter((entry) => entry.kind !== "system")) {
    const option = document.createElement("option");
    option.value = agent.id;
    option.textContent = `${agentLabel(agent)} (${agent.id})`;
    agentSelect.append(option);
  }
  if (route.agentId && !host.agents.rows.some((agent) => agent.id === route.agentId)) {
    const missing = document.createElement("option");
    missing.value = route.agentId;
    missing.textContent = `${route.agentId} (n\xE3o encontrado)`;
    agentSelect.append(missing);
  }
  agentSelect.value = route.agentId;
  agentField.append(agentSelect);
  const sessionField = document.createElement("label");
  sessionField.textContent = "Sess\xE3o";
  const sessionSelect = document.createElement("select");
  sessionSelect.setAttribute("aria-label", `Modo de sess\xE3o da conta ${route.accountId}`);
  sessionSelect.append(new Option("Principal do agente", "main"), new Option("Isolada por contato", "isolated"));
  sessionSelect.value = route.sessionMode;
  sessionField.append(sessionSelect);
  const enabledField = document.createElement("label");
  enabledField.className = "wa-agent-route-toggle";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = route.enabled;
  enabledField.append(enabled, document.createTextNode("Conta ativa"));
  const actions = document.createElement("div");
  actions.className = "wa-agent-route-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Salvar v\xEDnculo";
  save.disabled = !host.connection.canAdmin;
  const status = document.createElement("output");
  status.setAttribute("aria-live", "polite");
  save.onclick = async () => {
    const agentId = agentSelect.value.trim();
    if (!agentId) {
      status.textContent = "Selecione um agente.";
      status.dataset.tone = "danger";
      return;
    }
    save.disabled = true;
    status.textContent = "Salvando\u2026";
    status.dataset.tone = "neutral";
    try {
      const patch = buildAccountRoutePatch({
        accountId: route.accountId,
        agentId,
        enabled: enabled.checked,
        sessionMode: sessionSelect.value === "main" ? "main" : "isolated"
      }, hasAccounts);
      await host.request("config.patch", {
        raw: JSON.stringify(patch),
        baseHash: hash,
        note: `Atualiza\xE7\xE3o do v\xEDnculo WhatsApp ${route.accountId} \u2192 ${agentId}`
      });
      status.textContent = "V\xEDnculo salvo.";
      status.dataset.tone = "success";
      await reload();
    } catch (error) {
      status.textContent = "N\xE3o foi poss\xEDvel salvar. Atualize a p\xE1gina e tente novamente.";
      status.dataset.tone = "danger";
    } finally {
      if (!host.signal.aborted) save.disabled = !host.connection.canAdmin;
    }
  };
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remover v\xEDnculo";
  remove.disabled = !host.connection.canAdmin || !hasAccounts;
  remove.onclick = async () => {
    if (!window.confirm(`Remover a conta ${route.accountId} do WhatsApp? O agente, hist\xF3rico e segredo no cofre ser\xE3o preservados.`)) return;
    remove.disabled = true;
    save.disabled = true;
    try {
      await host.request("config.patch", { raw: JSON.stringify(buildAccountMutation(route.accountId, null)), baseHash: hash, note: `Remo\xE7\xE3o do v\xEDnculo WhatsApp ${route.accountId}` });
      await reload();
    } catch {
      status.textContent = "N\xE3o foi poss\xEDvel remover. Atualize a p\xE1gina e tente novamente.";
    } finally {
      remove.disabled = !host.connection.canAdmin;
      save.disabled = !host.connection.canAdmin;
    }
  };
  actions.append(save, remove, status);
  grid.append(agentField, sessionField, enabledField);
  card.append(title, grid, actions);
  return card;
}
function addAccountCard(host, routes, hasAccounts, hash, reload, usedSecrets) {
  const card = document.createElement("article");
  card.className = "wa-agent-route-card";
  const open = document.createElement("button");
  open.textContent = "+ Adicionar agente";
  open.type = "button";
  open.disabled = !host.connection.canAdmin || !hasAccounts && routes.length > 0;
  const form = document.createElement("form");
  form.className = "wa-agent-route-grid";
  form.hidden = true;
  const field = (label, input) => {
    input.setAttribute("aria-label", label);
    const element = document.createElement("label");
    element.textContent = label;
    element.append(input);
    form.append(element);
  };
  const id = document.createElement("input");
  id.required = true;
  id.pattern = "[a-z][a-z0-9_-]*";
  id.placeholder = "ex.: atendimento";
  field("Nome da conta", id);
  const agent = document.createElement("select");
  agent.required = true;
  agent.append(new Option("Selecione o agente", ""));
  for (const row of host.agents.rows.filter((row2) => row2.kind !== "system")) agent.append(new Option(`${agentLabel(row)} (${row.id})`, row.id));
  field("Agente existente", agent);
  const secret = document.createElement("select");
  secret.required = true;
  secret.append(new Option("Selecione a API salva no cofre", ""));
  field("API do WhatsApp", secret);
  const vault = document.createElement("a");
  vault.href = `${host.basePath.replace(/\/$/, "")}/settings/secrets`;
  vault.target = "_blank";
  vault.rel = "noopener";
  vault.textContent = "Cadastrar API no cofre protegido \u2197";
  const hint = document.createElement("p");
  hint.textContent = "No cofre: adicione um segredo com nome WHATSAPP_AGENT_NOME_TOKEN, informe o token no campo protegido e permita api.whatsapp.com. Volte aqui e atualize a lista. Nenhum token \xE9 exibido nesta p\xE1gina.";
  const update = document.createElement("button");
  update.type = "button";
  update.textContent = "Atualizar APIs";
  const status = document.createElement("output");
  status.setAttribute("aria-live", "polite");
  const loadSecrets = async () => {
    update.disabled = true;
    try {
      const result = await host.request("secrets.store.list", {});
      const selected = secret.value;
      secret.replaceChildren(new Option("Selecione a API salva no cofre", ""));
      for (const entry of result.entries.filter((entry2) => entry2.kind === "secret" && !usedSecrets.includes(entry2.name))) secret.append(new Option(entry.name, entry.name));
      secret.value = selected;
      status.textContent = "";
    } catch {
      status.textContent = "N\xE3o foi poss\xEDvel listar o cofre. Confira sua permiss\xE3o de administrador.";
    } finally {
      update.disabled = false;
    }
  };
  update.onclick = () => {
    void loadSecrets();
  };
  open.onclick = () => {
    form.hidden = !form.hidden;
    if (!form.hidden) {
      id.focus();
      void loadSecrets();
    }
  };
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Adicionar v\xEDnculo";
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      if (!host.agents.rows.some((row) => row.id === agent.value && row.kind !== "system")) throw new Error("Agente indispon\xEDvel.");
      const patch = buildNewAccountPatch(id.value.trim(), agent.value, secret.value, routes.map((route) => route.accountId));
      await host.request("config.patch", { raw: JSON.stringify(patch), baseHash: hash, note: `Adicionar v\xEDnculo WhatsApp ${id.value.trim()}` });
      await reload();
    } catch {
      status.textContent = "N\xE3o foi poss\xEDvel adicionar. Confira os campos, use um nome de conta \xFAnico e atualize a p\xE1gina antes de tentar novamente.";
    } finally {
      save.disabled = !host.connection.canAdmin;
    }
  };
  form.append(vault, hint, update, save, status);
  card.append(open, form);
  return card;
}
var control_ui_default = defineControlUiPlugin({
  id: "whatsapp-agent-admin",
  activate(host) {
    host.ui.registerNavigation({
      id: "whatsapp-agent-routing",
      label: "WhatsApp por agente",
      page: { id: "whatsapp-agent-routing" },
      icon: "messageCircle",
      order: 72
    });
    host.ui.registerPage({
      id: "whatsapp-agent-routing",
      label: "WhatsApp por agente",
      mount(container, context) {
        return mountAccountManager(container, host);
      }
    });
  }
});
function mountAccountManager(container, host) {
  const page = document.createElement("section");
  page.className = "wa-agent-routing-page";
  const header = document.createElement("header");
  const heading = document.createElement("h1");
  heading.textContent = "WhatsApp por agente";
  const description = document.createElement("p");
  description.textContent = "Adicione agentes ao WhatsApp, selecione a API no cofre protegido e gerencie os v\xEDnculos. Remover um v\xEDnculo n\xE3o apaga o agente.";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "wa-agent-secondary-button";
  refresh.textContent = "Atualizar";
  header.append(heading, description, refresh);
  const notice = document.createElement("p");
  notice.className = "wa-agent-route-notice";
  const list = document.createElement("div");
  list.className = "wa-agent-route-list";
  page.append(header, notice, list);
  container.append(page);
  const load = async () => {
    refresh.disabled = true;
    notice.textContent = "Carregando configura\xE7\xE3o\u2026";
    notice.dataset.tone = "neutral";
    list.replaceChildren();
    try {
      await host.agents.refresh();
      const snapshot = await host.request("config.get", {});
      if (host.signal.aborted) return;
      const routes = readAccountRoutes(snapshot.config);
      const hasAccounts = hasAccountMap(snapshot.config);
      const hash = snapshot.hash;
      if (!hash) throw new Error("O Gateway n\xE3o retornou a revis\xE3o da configura\xE7\xE3o.");
      notice.textContent = host.connection.canAdmin ? `${routes.length} conta(s) configurada(s).` : "Somente administradores podem alterar estes v\xEDnculos.";
      list.append(addAccountCard(host, routes, hasAccounts, hash, load, usedStoreSecrets(snapshot.config)));
      for (const route of routes) list.append(routeCard(host, route, hasAccounts, hash, load));
    } catch (error) {
      notice.textContent = error instanceof Error ? error.message : String(error);
      notice.dataset.tone = "danger";
    } finally {
      if (!host.signal.aborted) refresh.disabled = false;
    }
  };
  refresh.onclick = () => {
    void load();
  };
  void load();
  return { dispose: () => page.remove() };
}

// src/channels-settings.ts
var WhatsAppChannelsSettings = class extends HTMLElement {
  gatewayClient = null;
  admin = false;
  mountedClient = null;
  mountedAdmin = false;
  controller;
  cleanup;
  pending = false;
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  set client(value) {
    this.gatewayClient = value;
    this.schedule();
  }
  set canAdmin(value) {
    this.admin = value;
    this.schedule();
  }
  connectedCallback() {
    this.schedule();
  }
  disconnectedCallback() {
    this.dispose();
  }
  dispose() {
    this.controller?.abort();
    this.cleanup?.();
    this.cleanup = void 0;
    this.mountedClient = null;
    this.shadowRoot.replaceChildren();
  }
  schedule() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.mount();
    });
  }
  mount() {
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
    this.shadowRoot.append(style, container);
    let rows = [];
    const host = {
      signal: controller.signal,
      basePath: location.pathname.split("/settings/")[0],
      connection: { canAdmin: this.admin },
      request: async (method, params) => {
        if (controller.signal.aborted) throw new Error("P\xE1gina desconectada.");
        const result = await client.request(method, params);
        if (controller.signal.aborted) throw new Error("P\xE1gina desconectada.");
        return result;
      },
      agents: {
        get rows() {
          return rows;
        },
        async refresh() {
          const result = await host.request("agents.list", {});
          rows = result.agents;
        }
      }
    };
    this.cleanup = mountAccountManager(container, host).dispose;
  }
};
if (!customElements.get("whatsapp-channels-settings")) {
  customElements.define("whatsapp-channels-settings", WhatsAppChannelsSettings);
}
export {
  WhatsAppChannelsSettings
};
