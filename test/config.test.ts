import assert from "node:assert/strict";
import test from "node:test";
import { readPluginAccounts, readPluginConfig } from "../src/config.ts";

test("resolves a reusable installation from the selected agent workspace", () => {
  const config = readPluginConfig({ apiToken: "secret", agentId: "sales" }, {
    agents: {
      defaults: { workspace: "/srv/openclaw/default" },
      entries: { sales: { workspace: "/srv/openclaw/sales" } },
    },
  });
  assert.deepEqual(config, {
    apiToken: "secret",
    agentId: "sales",
    workspace: "/srv/openclaw/sales",
    stateNamespace: "whatsapp-agent-platform",
    pollTimeoutSeconds: 20,
    sessionMode: "isolated",
  });
});

test("keeps legacy workspace and state paths compatible", () => {
  const config = readPluginConfig({
    apiToken: "secret",
    agentId: "demo-admin",
    adminWorkspace: "/legacy/admin",
  }, { agents: {} });
  assert.equal(config.workspace, "/legacy/admin");
  assert.equal(config.stateNamespace, "whatsapp-agent-admin");
});

test("prefers explicit reusable workspace and validates runtime bounds", () => {
  const config = readPluginConfig({
    apiToken: "secret",
    workspace: "/explicit/workspace",
    adminWorkspace: "/legacy/workspace",
    stateNamespace: "tenant_one",
    pollTimeoutSeconds: 25,
  }, { agents: { defaults: { workspace: "/default" } } });
  assert.equal(config.workspace, "/explicit/workspace");
  assert.equal(config.stateNamespace, "tenant_one");
  assert.throws(
    () => readPluginConfig({ apiToken: "secret", workspace: "/tmp", pollTimeoutSeconds: 26 }, {}),
    /integer from 1 to 25/,
  );
  assert.throws(
    () => readPluginConfig({ apiToken: "secret", workspace: "/tmp", stateNamespace: "../escape" }, {}),
    /stateNamespace/,
  );
});

test("fails clearly when neither agent nor default workspace exists", () => {
  assert.throws(
    () => readPluginConfig({ apiToken: "secret", agentId: "missing" }, { agents: { entries: {} } }),
    /could not resolve a workspace/,
  );
});

test("supports routing WhatsApp into the agent main session", () => {
  const config = readPluginConfig({
    apiToken: "secret",
    agentId: "demo-sales",
    sessionMode: "main",
  }, { agents: { entries: { "demo-sales": { workspace: "/agents/sales" } } } });
  assert.equal(config.sessionMode, "main");
  assert.throws(
    () => readPluginConfig({ apiToken: "secret", workspace: "/tmp", sessionMode: "shared" }, {}),
    /sessionMode must be isolated or main/,
  );
});

test("resolves multiple enabled WhatsApp accounts independently", () => {
  const accounts = readPluginAccounts({
    accounts: {
      admin: { apiToken: "admin-token", agentId: "demo-admin" },
      sales: { apiToken: "sales-token", agentId: "demo-sales", workspace: "/custom/sales" },
      paused: { apiToken: "paused-token", agentId: "main", enabled: false },
    },
  }, {
    agents: {
      entries: {
        "demo-admin": { workspace: "/agents/admin" },
        "demo-sales": { workspace: "/agents/sales" },
      },
    },
  });

  assert.deepEqual(accounts.map(({ accountId, agentId, workspace, stateNamespace }) => ({
    accountId,
    agentId,
    workspace,
    stateNamespace,
  })), [
    { accountId: "admin", agentId: "demo-admin", workspace: "/agents/admin", stateNamespace: "whatsapp-agent-platform-admin" },
    { accountId: "sales", agentId: "demo-sales", workspace: "/custom/sales", stateNamespace: "whatsapp-agent-platform-sales" },
  ]);
});

test("allows all accounts to be disabled", () => {
  assert.deepEqual(readPluginAccounts({
    accounts: { paused: { apiToken: "token", agentId: "main", enabled: false } },
  }, { agents: { defaults: { workspace: "/default" } } }), []);
});

test("allows removing the last account", () => { assert.deepEqual(readPluginAccounts({ accounts: {} }, {}), []); });
