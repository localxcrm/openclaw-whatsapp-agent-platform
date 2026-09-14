export type PluginConfig = {
  accountId?: string;
  apiToken: string;
  agentId: string;
  workspace: string;
  stateNamespace: string;
  pollTimeoutSeconds: number;
  sessionMode: "isolated" | "main";
};

type OpenClawAgentConfig = {
  agents?: {
    defaults?: { workspace?: unknown };
    entries?: Record<string, { workspace?: unknown }> | Array<{ id?: unknown; workspace?: unknown }>;
  };
};

export function readPluginConfig(
  value: Record<string, unknown> | undefined,
  openClawConfig: OpenClawAgentConfig,
): PluginConfig {
  const apiToken = typeof value?.apiToken === "string" ? value.apiToken : "";
  if (!apiToken) throw new Error("whatsapp-agent-admin requires apiToken");

  const agentId = typeof value?.agentId === "string" && value.agentId.trim() ? value.agentId.trim() : "main";
  const legacyWorkspace = typeof value?.adminWorkspace === "string" && value.adminWorkspace.trim()
    ? value.adminWorkspace.trim()
    : undefined;
  const configuredWorkspace = typeof value?.workspace === "string" && value.workspace.trim()
    ? value.workspace.trim()
    : undefined;
  const entries = openClawConfig.agents?.entries;
  const agentWorkspace = Array.isArray(entries)
    ? entries.find((entry) => entry.id === agentId)?.workspace
    : entries?.[agentId]?.workspace;
  const defaultWorkspace = openClawConfig.agents?.defaults?.workspace;
  const workspace = configuredWorkspace
    ?? legacyWorkspace
    ?? (typeof agentWorkspace === "string" && agentWorkspace.trim() ? agentWorkspace.trim() : undefined)
    ?? (typeof defaultWorkspace === "string" && defaultWorkspace.trim() ? defaultWorkspace.trim() : undefined);
  if (!workspace) {
    throw new Error(`whatsapp-agent-admin could not resolve a workspace for agent ${agentId}; configure workspace`);
  }

  const stateNamespace = typeof value?.stateNamespace === "string" && value.stateNamespace.trim()
    ? value.stateNamespace.trim()
    : legacyWorkspace
      ? "whatsapp-agent-admin"
      : "whatsapp-agent-platform";
  if (!/^[a-z][a-z0-9_-]*$/.test(stateNamespace)) {
    throw new Error("whatsapp-agent-admin stateNamespace must match ^[a-z][a-z0-9_-]*$");
  }

  const pollTimeoutSeconds = typeof value?.pollTimeoutSeconds === "number" ? value.pollTimeoutSeconds : 20;
  if (!Number.isInteger(pollTimeoutSeconds) || pollTimeoutSeconds < 1 || pollTimeoutSeconds > 25) {
    throw new Error("whatsapp-agent-admin pollTimeoutSeconds must be an integer from 1 to 25");
  }

  const sessionMode = value?.sessionMode === undefined ? "isolated" : value.sessionMode;
  if (sessionMode !== "isolated" && sessionMode !== "main") {
    throw new Error("whatsapp-agent-admin sessionMode must be isolated or main");
  }

  return { apiToken, agentId, workspace, stateNamespace, pollTimeoutSeconds, sessionMode };
}

export function readPluginAccounts(
  value: Record<string, unknown> | undefined,
  openClawConfig: OpenClawAgentConfig,
): PluginConfig[] {
  const accounts = value?.accounts;
  if (accounts && typeof accounts === "object" && !Array.isArray(accounts)) {
    const resolved = Object.entries(accounts as Record<string, unknown>)
      .filter(([, entry]) => entry && typeof entry === "object" && !Array.isArray(entry))
      .filter(([, entry]) => (entry as Record<string, unknown>).enabled !== false)
      .map(([accountId, entry]) => {
        if (!/^[a-z][a-z0-9_-]*$/.test(accountId)) {
          throw new Error(`whatsapp-agent-admin account id ${accountId} must match ^[a-z][a-z0-9_-]*$`);
        }
        const account = entry as Record<string, unknown>;
        return {
          ...readPluginConfig({
            ...account,
            stateNamespace: account.stateNamespace ?? `whatsapp-agent-platform-${accountId}`,
          }, openClawConfig),
          accountId,
        };
      });
    return resolved;
  }
  return [readPluginConfig(value, openClawConfig)];
}
