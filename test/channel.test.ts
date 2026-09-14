import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/channel-core";
import { createNativeChannel, inspectAccounts } from "../src/channel.ts";

const cfg = (transport = "channel"): OpenClawConfig => ({
  plugins: { entries: { "whatsapp-agent-admin": { config: { transport, accounts: {
    admin: { apiToken: { source: "store", provider: "default", id: "TEST_REFERENCE" }, agentId: "demo-admin" },
    sales: { apiToken: "test-only", agentId: "demo-sales", enabled: false },
  } } } } },
});
const load = async () => ({ media: [], refs: [] });
const understand = async () => undefined;
test("inspection exposes metadata only and legacy mode cannot start a native poller", () => {
  assert.deepEqual(inspectAccounts(cfg()), [
    { accountId: "admin", enabled: true, configured: true },
    { accountId: "sales", enabled: false, configured: true },
  ]);
  assert(inspectAccounts(cfg("legacy")).every(a => !a.enabled));
  const channel = createNativeChannel({} as OpenClawPluginApi, load, understand);
  assert.throws(() => channel.config.resolveAccount(cfg()), /explicitly/);
  assert.equal(channel.config.resolveAccount(cfg(), "missing").configured, false);
});
test("native poller dispatches trusted source metadata, replies once, and stops cleanly", async t => {
  const stateDir = await mkdtemp(join(tmpdir(), "wa-native-test-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const abort = new AbortController();
  const sends: unknown[] = [];
  let polls = 0;
  t.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/statuses")) return Response.json({});
    if (url.endsWith("/messages")) {
      sends.push(JSON.parse(String(init?.body)));
      return Response.json({ messages: [{ id: "sent-1" }] });
    }
    if (++polls <= 2) return Response.json({ entry: [{ changes: [{ value: { messages: [
      { id: "incoming-1", from: "user:42", type: "text", text: { body: "Hello" } },
    ] } }] }], next_offset: polls });
    abort.abort();
    return new Response(null, { status: 204 });
  });
  let routed: Record<string, unknown> | undefined;
  const api = {
    pluginConfig: { transport: "channel", accounts: { admin: { apiToken: "test-only", agentId: "demo-admin", workspace: stateDir } } },
    logger: { info() {}, warn() {}, error(message: string) { throw new Error(message); } },
    runtime: { state: { resolveStateDir: () => stateDir }, channel: {
      routing: { resolveAgentRoute(input: Record<string, unknown>) { routed = input; return { agentId: "demo-admin", sessionKey: "agent:demo-admin:whatsapp-agent:admin:direct:user:42" }; } },
      reply: { finalizeInboundContext: (input: unknown) => input },
      session: { resolveStorePath: () => join(stateDir, "sessions.json") },
    } },
  } as unknown as OpenClawPluginApi;
  let dispatches = 0;
  const channel = createNativeChannel(api, load, understand, async params => {
    dispatches++;
    assert.equal(params.ctxPayload.SenderId, "user:42");
    assert.equal(params.ctxPayload.MessageSid, "incoming-1");
    assert.equal(params.ctxPayload.OriginatingChannel, "whatsapp-agent");
    assert.equal(params.ctxPayload.CommandAuthorized, false);
    assert.equal(params.accountId, "admin");
    await params.deliver({ text: "Native response" });
  });
  let status = { accountId: "admin", running: false };
  await channel.gateway!.startAccount!({ cfg: cfg(), accountId: "admin", account: channel.config.resolveAccount(cfg(), "admin"),
    runtime: {} as never, abortSignal: abort.signal,
    getStatus: () => status, setStatus: next => { status = { ...status, ...next }; },
  });
  assert.equal(dispatches, 1);
  assert.equal(sends.length, 1);
  assert.equal(routed?.dmScope, "per-account-channel-peer");
  assert.equal(routed?.defaultAgentId, "demo-admin");
  assert.equal(status.running, false);
  await assert.rejects(channel.outbound!.sendText!({ cfg: cfg(), accountId: "admin", to: "user:42", text: "Stopped" }), /not running/);
});

test("outbound delivery works while the native poller is still starting", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "wa-native-starting-test-"));
  try {
    const sends: unknown[] = [];
    const api = {
      pluginConfig: { transport: "channel", accounts: { admin: { apiToken: "test-only", agentId: "demo-admin", workspace: stateDir } } },
      logger: { info() {}, warn() {}, error() {} },
      runtime: { state: { resolveStateDir: () => stateDir } },
    } as unknown as OpenClawPluginApi;
    const channel = createNativeChannel(api, load, understand);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      sends.push(JSON.parse(String(init?.body)));
      return Response.json({ messages: [{ id: "sent-starting-1" }] });
    };
    try {
      const result = await channel.outbound!.sendText!({ cfg: cfg(), accountId: "admin", to: "user:42", text: "Starting" });
      assert.equal(result.messageId, "sent-starting-1");
      assert.equal(sends.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("entry registers exactly one transport and supports channel discovery without secrets", async () => {
  const { default: entry } = await import("../index.ts");
  for (const mode of ["legacy", "channel", "discovery"]) {
    let channels = 0;
    let services = 0;
    entry.register({
      registrationMode: mode === "discovery" ? "discovery" : "full",
      pluginConfig: mode === "discovery" ? undefined : { transport: mode, apiToken: "test-only", workspace: "/tmp/test", agentId: "main" },
      config: {},
      registerChannel() { channels++; }, registerService() { services++; },
    } as unknown as OpenClawPluginApi);
    assert.equal(channels, 1);
    assert.equal(services, mode === "legacy" ? 1 : 0);
  }
});
