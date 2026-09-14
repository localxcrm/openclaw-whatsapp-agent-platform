import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountRoutePatch, readAccountRoutes } from "../src/control-ui-model.ts";

test("reads and sorts multi-account agent routes", () => {
  const routes = readAccountRoutes({ plugins: { entries: { "whatsapp-agent-admin": { config: { accounts: {
    sales: { agentId: "demo-sales", enabled: false, sessionMode: "main", apiToken: "redacted" },
    admin: { agentId: "demo-admin" },
  } } } } } });
  assert.deepEqual(routes, [
    { accountId: "admin", agentId: "demo-admin", enabled: true, sessionMode: "isolated" },
    { accountId: "sales", agentId: "demo-sales", enabled: false, sessionMode: "main" },
  ]);
});

test("reads a legacy single-account route", () => {
  assert.deepEqual(readAccountRoutes({ plugins: { entries: { "whatsapp-agent-admin": { config: {
    agentId: "main", sessionMode: "main", apiToken: "redacted",
  } } } } }), [
    { accountId: "default", agentId: "main", enabled: true, sessionMode: "main" },
  ]);
});

test("builds a narrow merge patch that does not include credentials", () => {
  const patch = buildAccountRoutePatch({ accountId: "admin", agentId: "demo-admin", enabled: true, sessionMode: "isolated" }, true);
  assert.deepEqual(patch, { plugins: { entries: { "whatsapp-agent-admin": { config: { accounts: {
    admin: { agentId: "demo-admin", enabled: true, sessionMode: "isolated" },
  } } } } } });
  assert.equal(JSON.stringify(patch).includes("apiToken"), false);
});

import { hasAccountMap, buildNewAccountPatch, buildAccountMutation } from "../src/control-ui-model.ts";
test("distinguishes a named default account from a legacy account", () => {
  assert.equal(hasAccountMap({ plugins: { entries: { "whatsapp-agent-admin": { config: { accounts: { default: {} } } } } } }), true);
  assert.equal(hasAccountMap({ plugins: { entries: { "whatsapp-agent-admin": { config: { apiToken: "redacted" } } } } }), false);
});
test("add stores only a protected reference and rejects duplicates and unsafe keys", () => {
  const patch = JSON.stringify(buildNewAccountPatch("support", "demo-admin", "WHATSAPP_SUPPORT_TOKEN", []));
  assert.match(patch, /"source":"store"/);
  assert.throws(() => buildNewAccountPatch("support", "demo-admin", "WHATSAPP_SUPPORT_TOKEN", ["support"]));
  assert.throws(() => buildAccountMutation("constructor", null));
  assert.throws(() => buildNewAccountPatch("support", "demo-admin", "token-with-value", []));
});
test("remove patches only the chosen account, without deleting agents or secrets", () => {
  assert.deepEqual(buildAccountMutation("sales", null), { plugins: { entries: { "whatsapp-agent-admin": { config: { accounts: { sales: null } } } } } });
});
