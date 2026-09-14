export type ChannelAccountRoute = {
  accountId: string;
  agentId: string;
  enabled: boolean;
  sessionMode: "isolated" | "main";
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

export function readAccountRoutes(config: unknown): ChannelAccountRoute[] {
  const root = asRecord(config);
  const plugins = asRecord(root?.plugins);
  const entries = asRecord(plugins?.entries);
  const plugin = asRecord(entries?.["whatsapp-agent-admin"]);
  const pluginConfig = asRecord(plugin?.config);
  const accounts = asRecord(pluginConfig?.accounts);

  if (accounts) {
    return Object.entries(accounts)
      .flatMap(([accountId, value]) => {
        const account = asRecord(value);
        if (!account) return [];
        return [{
          accountId,
          agentId: typeof account.agentId === "string" ? account.agentId : "",
          enabled: account.enabled !== false,
          sessionMode: account.sessionMode === "main" ? "main" as const : "isolated" as const,
        }];
      })
      .sort((left, right) => left.accountId.localeCompare(right.accountId));
  }

  if (!pluginConfig) return [];
  return [{
    accountId: "default",
    agentId: typeof pluginConfig.agentId === "string" ? pluginConfig.agentId : "main",
    enabled: true,
    sessionMode: pluginConfig.sessionMode === "main" ? "main" : "isolated",
  }];
}

export function buildAccountRoutePatch(route: ChannelAccountRoute, hasAccounts: boolean): UnknownRecord {
  const routePatch = {
    agentId: route.agentId,
    enabled: route.enabled,
    sessionMode: route.sessionMode,
  };
  return {
    plugins: {
      entries: {
        "whatsapp-agent-admin": {
          config: hasAccounts ? { accounts: { [route.accountId]: routePatch } } : routePatch,
        },
      },
    },
  };
}

export function hasAccountMap(config: unknown): boolean {
  const root = asRecord(config);
  return Boolean(asRecord(asRecord(asRecord(asRecord(asRecord(root?.plugins)?.entries)?.["whatsapp-agent-admin"])?.config)?.accounts));
}

export function buildAccountMutation(accountId: string, account: UnknownRecord | null): UnknownRecord {
  if (!/^[a-z][a-z0-9_-]*$/.test(accountId) || ["constructor", "prototype", "__proto__"].includes(accountId)) {
    throw new Error("Use um identificador com letras minúsculas, números, hífen ou sublinhado.");
  }
  return { plugins: { entries: { "whatsapp-agent-admin": { config: { accounts: { [accountId]: account } } } } } };
}

export function buildNewAccountPatch(accountId: string, agentId: string, secretName: string, existingIds: string[]): UnknownRecord {
  if (existingIds.includes(accountId)) throw new Error("Já existe uma conta com esse identificador.");
  if (!/^[a-z][a-z0-9_-]*$/.test(agentId)) throw new Error("Selecione um agente válido.");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(secretName)) throw new Error("Selecione a API no cofre protegido.");
  return buildAccountMutation(accountId, { agentId, apiToken: { source: "store", provider: "default", id: secretName }, enabled: true, sessionMode: "isolated" });
}

export function usedStoreSecrets(config: unknown): string[] {
  const root = asRecord(config);
  const cfg = asRecord(asRecord(asRecord(asRecord(root?.plugins)?.entries)?.["whatsapp-agent-admin"])?.config);
  const accounts = asRecord(cfg?.accounts);
  return Object.values(accounts ?? {}).flatMap(value => {
    const token = asRecord(asRecord(value)?.apiToken);
    return token?.source === "store" && typeof token.id === "string" ? [token.id] : [];
  });
}
