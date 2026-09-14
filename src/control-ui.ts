import { defineControlUiPlugin, type ControlUiAgent, type ControlUiHost } from "openclaw/plugin-sdk/control-ui";
import { buildAccountRoutePatch, readAccountRoutes, hasAccountMap, buildAccountMutation, buildNewAccountPatch, usedStoreSecrets, type ChannelAccountRoute } from "./control-ui-model.js";
import "./control-ui.css";

export type AccountManagerHost = Pick<ControlUiHost, "request" | "signal" | "basePath"> & { agents: Pick<ControlUiHost["agents"], "rows" | "refresh">; connection: Pick<ControlUiHost["connection"], "canAdmin"> };

type ConfigSnapshot = { config?: unknown; hash?: string };

function agentLabel(agent: ControlUiAgent): string {
  const identity = agent.identity as { name?: string } | undefined;
  return identity?.name?.trim() || agent.name?.trim() || agent.id;
}

function routeCard(host: AccountManagerHost, route: ChannelAccountRoute, hasAccounts: boolean, hash: string, reload: () => Promise<void>): HTMLElement {
  const card = document.createElement("article");
  card.className = "wa-agent-route-card";
  const title = document.createElement("h2");
  title.textContent = route.accountId;
  const grid = document.createElement("div");
  grid.className = "wa-agent-route-grid";

  const agentField = document.createElement("label");
  agentField.textContent = "Agente responsável";
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
    missing.textContent = `${route.agentId} (não encontrado)`;
    agentSelect.append(missing);
  }
  agentSelect.value = route.agentId;
  agentField.append(agentSelect);

  const sessionField = document.createElement("label");
  sessionField.textContent = "Sessão";
  const sessionSelect = document.createElement("select");
  sessionSelect.setAttribute("aria-label", `Modo de sessão da conta ${route.accountId}`);
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
  save.textContent = "Salvar vínculo";
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
    status.textContent = "Salvando…";
    status.dataset.tone = "neutral";
    try {
      const patch = buildAccountRoutePatch({
        accountId: route.accountId,
        agentId,
        enabled: enabled.checked,
        sessionMode: sessionSelect.value === "main" ? "main" : "isolated",
      }, hasAccounts);
      await host.request("config.patch", {
        raw: JSON.stringify(patch),
        baseHash: hash,
        note: `Atualização do vínculo WhatsApp ${route.accountId} → ${agentId}`,
      });
      status.textContent = "Vínculo salvo.";
      status.dataset.tone = "success";
      await reload();
    } catch (error) {
      status.textContent = "Não foi possível salvar. Atualize a página e tente novamente.";
      status.dataset.tone = "danger";
    } finally {
      if (!host.signal.aborted) save.disabled = !host.connection.canAdmin;
    }
  };
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remover vínculo";
  remove.disabled = !host.connection.canAdmin || !hasAccounts;
  remove.onclick = async () => {
    if (!window.confirm(`Remover a conta ${route.accountId} do WhatsApp? O agente, histórico e segredo no cofre serão preservados.`)) return;
    remove.disabled = true;
    save.disabled = true;
    try {
      await host.request("config.patch", { raw: JSON.stringify(buildAccountMutation(route.accountId, null)), baseHash: hash, note: `Remoção do vínculo WhatsApp ${route.accountId}` });
      await reload();
    } catch {
      status.textContent = "Não foi possível remover. Atualize a página e tente novamente.";
    } finally { remove.disabled = !host.connection.canAdmin; save.disabled = !host.connection.canAdmin; }
  };
  actions.append(save, remove, status);
  grid.append(agentField, sessionField, enabledField);
  card.append(title, grid, actions);
  return card;
}

function addAccountCard(host: AccountManagerHost, routes: ChannelAccountRoute[], hasAccounts: boolean, hash: string, reload: () => Promise<void>, usedSecrets: string[]): HTMLElement {
  const card = document.createElement("article");
  card.className = "wa-agent-route-card";
  const open = document.createElement("button");
  open.textContent = "+ Adicionar agente";
  open.type = "button";
  open.disabled = !host.connection.canAdmin || (!hasAccounts && routes.length > 0);
  const form = document.createElement("form");
  form.className = "wa-agent-route-grid";
  form.hidden = true;
  const field = (label: string, input: HTMLElement) => {
    input.setAttribute("aria-label", label);
    const element = document.createElement("label"); element.textContent = label; element.append(input); form.append(element);
  };
  const id = document.createElement("input");
  id.required = true; id.pattern = "[a-z][a-z0-9_-]*"; id.placeholder = "ex.: atendimento";
  field("Nome da conta", id);
  const agent = document.createElement("select"); agent.required = true;
  agent.append(new Option("Selecione o agente", ""));
  for (const row of host.agents.rows.filter(row => row.kind !== "system")) agent.append(new Option(`${agentLabel(row)} (${row.id})`, row.id));
  field("Agente existente", agent);
  const secret = document.createElement("select"); secret.required = true;
  secret.append(new Option("Selecione a API salva no cofre", ""));
  field("API do WhatsApp", secret);
  const vault = document.createElement("a");
  vault.href = `${host.basePath.replace(/\/$/, "")}/settings/secrets`;
  vault.target = "_blank"; vault.rel = "noopener";
  vault.textContent = "Cadastrar API no cofre protegido ↗";
  const hint = document.createElement("p");
  hint.textContent = "No cofre: adicione um segredo com nome WHATSAPP_AGENT_NOME_TOKEN, informe o token no campo protegido e permita api.whatsapp.com. Volte aqui e atualize a lista. Nenhum token é exibido nesta página.";
  const update = document.createElement("button"); update.type = "button"; update.textContent = "Atualizar APIs";
  const status = document.createElement("output"); status.setAttribute("aria-live", "polite");
  const loadSecrets = async () => {
    update.disabled = true;
    try {
      const result = await host.request<{ entries: { name: string; kind: string }[] }>("secrets.store.list", {});
      const selected = secret.value;
      secret.replaceChildren(new Option("Selecione a API salva no cofre", ""));
      for (const entry of result.entries.filter(entry => entry.kind === "secret" && !usedSecrets.includes(entry.name))) secret.append(new Option(entry.name, entry.name));
      secret.value = selected;
      status.textContent = "";
    } catch { status.textContent = "Não foi possível listar o cofre. Confira sua permissão de administrador."; }
    finally { update.disabled = false; }
  };
  update.onclick = () => { void loadSecrets(); };
  open.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) { id.focus(); void loadSecrets(); } };
  const save = document.createElement("button"); save.type = "submit"; save.textContent = "Adicionar vínculo";
  form.onsubmit = async event => {
    event.preventDefault(); save.disabled = true;
    try {
      if (!host.agents.rows.some(row => row.id === agent.value && row.kind !== "system")) throw new Error("Agente indisponível.");
      const patch = buildNewAccountPatch(id.value.trim(), agent.value, secret.value, routes.map(route => route.accountId));
      await host.request("config.patch", { raw: JSON.stringify(patch), baseHash: hash, note: `Adicionar vínculo WhatsApp ${id.value.trim()}` });
      await reload();
    } catch { status.textContent = "Não foi possível adicionar. Confira os campos, use um nome de conta único e atualize a página antes de tentar novamente."; }
    finally { save.disabled = !host.connection.canAdmin; }
  };
  form.append(vault, hint, update, save, status);
  card.append(open, form);
  return card;
}

export default defineControlUiPlugin({
  id: "whatsapp-agent-admin",
  activate(host) {
    host.ui.registerNavigation({
      id: "whatsapp-agent-routing",
      label: "WhatsApp por agente",
      page: { id: "whatsapp-agent-routing" },
      icon: "messageCircle",
      order: 72,
    });
    host.ui.registerPage({
      id: "whatsapp-agent-routing",
      label: "WhatsApp por agente",
      mount(container, context) {
        return mountAccountManager(container, host);
      },
    });
  },
});

export function mountAccountManager(container: HTMLElement, host: AccountManagerHost) {
        const page = document.createElement("section");
        page.className = "wa-agent-routing-page";
        const header = document.createElement("header");
        const heading = document.createElement("h1");
        heading.textContent = "WhatsApp por agente";
        const description = document.createElement("p");
        description.textContent = "Adicione agentes ao WhatsApp, selecione a API no cofre protegido e gerencie os vínculos. Remover um vínculo não apaga o agente.";
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
          notice.textContent = "Carregando configuração…";
          notice.dataset.tone = "neutral";
          list.replaceChildren();
          try {
            await host.agents.refresh();
            const snapshot = await host.request<ConfigSnapshot>("config.get", {});
            if (host.signal.aborted) return;
            const routes = readAccountRoutes(snapshot.config);
            const hasAccounts = hasAccountMap(snapshot.config);
            const hash = snapshot.hash;
            if (!hash) throw new Error("O Gateway não retornou a revisão da configuração.");

            notice.textContent = host.connection.canAdmin
              ? `${routes.length} conta(s) configurada(s).`
              : "Somente administradores podem alterar estes vínculos.";
            list.append(addAccountCard(host, routes, hasAccounts, hash, load, usedStoreSecrets(snapshot.config)));
            for (const route of routes) list.append(routeCard(host, route, hasAccounts, hash, load));
          } catch (error) {
            notice.textContent = error instanceof Error ? error.message : String(error);
            notice.dataset.tone = "danger";
          } finally {
            if (!host.signal.aborted) refresh.disabled = false;
          }
        };
        refresh.onclick = () => { void load(); };
        void load();
        return { dispose: () => page.remove() };
}
