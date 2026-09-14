import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAgentMessage, extractMessages, normalizeApiToken, normalizeReply, resolveSessionKey, WhatsAppAgentAdminBridge } from "../src/bridge.ts";

const logger = { info() {}, warn() {}, error() {} };

test("extracts nested inbound messages", () => {
  const message = { id: "wamid.1", from: "user:1", type: "text", text: { body: "Oi" } };
  assert.deepEqual(extractMessages({ entry: [{ changes: [{ value: { messages: [message] } }] }] }), [message]);
});

test("truncates replies to the platform limit", () => {
  assert.equal(normalizeReply(`  ${"x".repeat(5_000)}  `).length, 4096);
});

test("normalizes copied API tokens", () => {
  assert.equal(normalizeApiToken("  secret-token\n"), "secret-token");
  assert.equal(normalizeApiToken("Bearer secret-token"), "secret-token");
  assert.throws(() => normalizeApiToken(" Bearer   "), /non-empty apiToken/);
});

test("routes to the primary agent session when main session mode is selected", () => {
  assert.equal(
    resolveSessionKey({ agentId: "demo-sales", accountId: "sales", sessionMode: "main" }, "user:42"),
    "agent:demo-sales:main",
  );
  assert.match(
    resolveSessionKey({ agentId: "demo-sales", accountId: "sales", sessionMode: "isolated" }, "user:42"),
    /^agent:demo-sales:whatsapp-agent:sales:direct:/,
  );
});

test("sends exactly one Bearer prefix after token normalization", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "wa-agent-admin-test-"));
  const controller = new AbortController();
  let authorization: string | null = null;
  const bridge = new WhatsAppAgentAdminBridge({
    token: "  Bearer secret-token\n",
    agentId: "demo-admin",
    adminWorkspace: "/tmp/admin",
    stateDir,
    pollTimeoutSeconds: 20,
    logger,
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get("Authorization");
      controller.abort();
      return new Response(null, { status: 204 });
    },
    async runAgent() { return { kind: "silent" }; },
  });
  await bridge.run(controller.signal);
  assert.equal(authorization, "Bearer secret-token");
});

test("starts at head, sends once, persists offset, and deduplicates replay", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "wa-agent-admin-test-"));
  const calls: Array<{ url: string; body?: string }> = [];
  const polls = [
    { entry: [{ changes: [{ value: { messages: [{ id: "wamid.1", from: "user:42", type: "text", text: { body: "Oi" } }] } }] }], next_offset: 9 },
    { entry: [{ changes: [{ value: { messages: [{ id: "wamid.1", from: "user:42", type: "text", text: { body: "Oi" } }] } }] }], next_offset: 10 },
  ];
  const controller = new AbortController();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.endsWith("/statuses")) return new Response("{}", { status: 200 });
    if (url.endsWith("/messages")) return new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 });
    const payload = polls.shift();
    if (payload) return new Response(JSON.stringify(payload), { status: 200 });
    controller.abort();
    return new Response(null, { status: 204 });
  };
  let runs = 0;
  const bridge = new WhatsAppAgentAdminBridge({
    token: "secret",
    agentId: "demo-admin",
    adminWorkspace: "/tmp/admin",
    stateDir,
    pollTimeoutSeconds: 20,
    fetchImpl,
    logger,
    async runAgent() { runs += 1; return { kind: "visible", text: "Olá" }; },
  });
  await bridge.run(controller.signal);

  assert.equal(runs, 1);
  const pollUrls = calls.filter((call) => call.url.includes("/updates"));
  assert.equal(new URL(pollUrls[0].url).searchParams.has("offset"), false);
  assert.equal(new URL(pollUrls[1].url).searchParams.get("offset"), "9");
  const sends = calls.filter((call) => call.url.endsWith("/messages"));
  assert.equal(sends.length, 1);
  assert.deepEqual(JSON.parse(sends[0].body ?? "{}"), {
    messaging_product: "whatsapp",
    to: "user:42",
    type: "text",
    text: { body: "Olá" },
  });
  const state = JSON.parse(await readFile(join(stateDir, "whatsapp-agent-platform", "state.json"), "utf8"));
  assert.equal(state.offset, "10");
  assert.equal(state.handled["wamid.1"].status, "sent");
  const statuses = calls.filter((call) => call.url.endsWith("/statuses"));
  assert.equal(statuses.length, 1);
  assert.deepEqual(JSON.parse(statuses[0].body ?? "{}"), {
    messaging_product: "whatsapp",
    status: "read",
    message_id: "wamid.1",
    typing_indicator: { type: "text" },
  });
});

test("downloads and routes an audio message with validated metadata", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "wa-agent-admin-media-test-"));
  const audio = Buffer.from("fake-audio-payload");
  const sha256 = createHash("sha256").update(audio).digest("base64");
  const controller = new AbortController();
  let attachment: Parameters<NonNullable<ConstructorParameters<typeof WhatsAppAgentAdminBridge>[0]["runAgent"]>>[0]["attachment"];
  let delivered = false;
  const bridge = new WhatsAppAgentAdminBridge({
    token: "secret",
    agentId: "demo-admin",
    adminWorkspace: "/tmp/admin",
    stateDir,
    pollTimeoutSeconds: 20,
    logger,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/statuses")) return new Response("{}", { status: 200 });
      if (url.endsWith("/media/media-1")) {
        return new Response(JSON.stringify({
          url: "https://lookaside.fbsbx.com/audio",
          mime_type: "audio/ogg",
          sha256,
          file_size: audio.length,
        }), { status: 200 });
      }
      if (url === "https://lookaside.fbsbx.com/audio") return new Response(audio, { status: 200 });
      if (url.endsWith("/messages")) return new Response(JSON.stringify({ messages: [{ id: "wamid.out.audio" }] }), { status: 200 });
      if (!delivered) {
        delivered = true;
        return new Response(JSON.stringify({
          entry: [{ changes: [{ value: { messages: [{
            id: "wamid.audio",
            from: "user:42",
            type: "audio",
            audio: { id: "media-1", mime_type: "audio/ogg", voice: true },
          }] } }] }],
          next_offset: 12,
        }), { status: 200 });
      }
      controller.abort();
      return new Response(null, { status: 204 });
    },
    async runAgent(params) {
      attachment = params.attachment;
      return { kind: "visible", text: "Entendi o áudio" };
    },
  });
  await bridge.run(controller.signal);

  assert.equal(attachment?.kind, "audio");
  assert.equal(attachment?.contentType, "audio/ogg");
  assert.equal(attachment?.voice, true);
  assert.deepEqual(await readFile(attachment?.path ?? ""), audio);
  assert.equal((await stat(attachment?.path ?? "")).mode & 0o777, 0o600);
});

test("builds an agent prompt with extracted media content and path privacy instruction", () => {
  const prompt = buildAgentMessage("Veja isto", {
    kind: "image",
    path: "/private/media/photo.jpg",
    filename: "photo.jpg",
    contentType: "image/jpeg",
    size: 123,
  }, "Uma parede azul");
  assert.match(prompt, /Uma parede azul/);
  assert.match(prompt, /Veja isto/);
  assert.match(prompt, /Não revele o caminho local/);
});

test("uploads and sends generated audio and video as native WhatsApp media", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "wa-agent-admin-outbound-media-test-"));
  const controller = new AbortController();
  const messagePayloads: unknown[] = [];
  const uploads: FormData[] = [];
  let delivered = false;
  const bridge = new WhatsAppAgentAdminBridge({
    token: "secret",
    agentId: "demo-admin",
    adminWorkspace: "/tmp/admin",
    stateDir,
    pollTimeoutSeconds: 20,
    logger,
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/statuses")) return new Response("{}", { status: 200 });
      if (url.endsWith("/media") && init?.method === "POST") {
        assert.ok(init.body instanceof FormData);
        uploads.push(init.body);
        return new Response(JSON.stringify({ id: `media-${uploads.length}` }), { status: 200 });
      }
      if (url.endsWith("/messages")) {
        messagePayloads.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ messages: [{ id: `wamid.out.${messagePayloads.length}` }] }), { status: 200 });
      }
      if (!delivered) {
        delivered = true;
        return new Response(JSON.stringify({
          entry: [{ changes: [{ value: { messages: [{ id: "wamid.media-reply", from: "user:42", type: "text", text: { body: "Responda em áudio e vídeo" } }] } }] }],
          next_offset: 13,
        }), { status: 200 });
      }
      controller.abort();
      return new Response(null, { status: 204 });
    },
    async runAgent() {
      return {
        kind: "visible",
        text: "Legenda do vídeo",
        media: [
          { kind: "audio", buffer: Buffer.from("opus"), contentType: "audio/ogg; codecs=opus", filename: "voice.ogg", voice: true },
          { kind: "video", buffer: Buffer.from("mp4"), contentType: "video/mp4; codecs=avc1", filename: "video.mp4" },
        ],
      };
    },
  });

  await bridge.run(controller.signal);

  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].get("messaging_product"), "whatsapp");
  assert.equal(uploads[0].get("type"), "audio/ogg");
  assert.equal((uploads[0].get("file") as File).name, "voice.ogg");
  assert.deepEqual(messagePayloads, [
    {
      messaging_product: "whatsapp",
      to: "user:42",
      type: "audio",
      audio: { id: "media-1" },
    },
    {
      messaging_product: "whatsapp",
      to: "user:42",
      type: "video",
      video: { id: "media-2", caption: "Legenda do vídeo" },
    },
  ]);
});

test("keeps polling after a permanent outbound media rejection", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "wa-agent-admin-media-rejection-test-"));
  const controller = new AbortController();
  let delivered = false;
  let textSends = 0;
  const bridge = new WhatsAppAgentAdminBridge({
    token: "secret",
    agentId: "demo-admin",
    adminWorkspace: "/tmp/admin",
    stateDir,
    pollTimeoutSeconds: 20,
    logger,
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/statuses")) return new Response("{}", { status: 200 });
      if (url.endsWith("/media") && init?.method === "POST") {
        return new Response(JSON.stringify({
          error: {
            code: 131053,
            message: "The declared media type is not one WhatsApp can render",
            error_data: { details: "Unsupported MIME type" },
          },
        }), { status: 400 });
      }
      if (url.endsWith("/messages")) {
        textSends += 1;
        controller.abort();
        return new Response(JSON.stringify({ messages: [{ id: "wamid.out.ok" }] }), { status: 200 });
      }
      if (!delivered) {
        delivered = true;
        return new Response(JSON.stringify({
          entry: [{ changes: [{ value: { messages: [
            { id: "wamid.bad-media", from: "user:42", type: "text", text: { body: "áudio" } },
            { id: "wamid.next-text", from: "user:42", type: "text", text: { body: "texto" } },
          ] } }] }],
          next_offset: 14,
        }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    },
    async runAgent(params) {
      if (params.message === "áudio") {
        return {
          kind: "visible",
          text: "",
          media: [{ kind: "audio", buffer: Buffer.from("opus"), contentType: "audio/ogg", filename: "voice.ogg" }],
        };
      }
      return { kind: "visible", text: "continua funcionando" };
    },
  });

  await bridge.run(controller.signal);

  assert.equal(textSends, 1);
  const state = JSON.parse(await readFile(join(stateDir, "whatsapp-agent-platform", "state.json"), "utf8"));
  assert.equal(state.handled["wamid.bad-media"].status, "failed");
  assert.equal(state.handled["wamid.next-text"].status, "sent");
});

test("does not resend after an ambiguous send failure", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "wa-agent-admin-test-"));
  const controller = new AbortController();
  let sends = 0;
  const bridge = new WhatsAppAgentAdminBridge({
    token: "secret",
    agentId: "demo-admin",
    adminWorkspace: "/tmp/admin",
    stateDir,
    pollTimeoutSeconds: 20,
    logger,
    fetchImpl: async (input) => {
      if (String(input).endsWith("/statuses")) return new Response("{}", { status: 200 });
      if (String(input).endsWith("/messages")) { sends += 1; throw new Error("socket reset"); }
      return new Response(JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ id: "wamid.2", from: "user:42", type: "text", text: { body: "Oi" } }] } }] }],
        next_offset: 11,
      }), { status: 200 });
    },
    async runAgent() { return { kind: "visible", text: "Olá" }; },
  });
  const run = bridge.run(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();
  await run;
  assert.equal(sends, 1);
  const state = JSON.parse(await readFile(join(stateDir, "whatsapp-agent-platform", "state.json"), "utf8"));
  assert.equal(state.handled["wamid.2"].status, "unknown");
});

test("isolates session and idempotency keys between configured accounts", async () => {
  async function capture(accountId: string): Promise<{ sessionKey: string; idempotencyKey: string }> {
    const stateDir = await mkdtemp(join(tmpdir(), `wa-agent-${accountId}-`));
    const controller = new AbortController();
    let delivered = false;
    let captured: { sessionKey: string; idempotencyKey: string } | undefined;
    const bridge = new WhatsAppAgentAdminBridge({
      token: `${accountId}-token`,
      accountId,
      agentId: "shared-agent",
      adminWorkspace: "/tmp/shared",
      stateDir,
      stateNamespace: `state-${accountId}`,
      pollTimeoutSeconds: 20,
      logger,
      fetchImpl: async (input) => {
        if (String(input).endsWith("/statuses")) return new Response("{}", { status: 200 });
        if (!delivered) {
          delivered = true;
          return new Response(JSON.stringify({
            entry: [{ changes: [{ value: { messages: [{ id: "same-message", from: "user:42", type: "text", text: { body: "Oi" } }] } }] }],
            next_offset: 1,
          }), { status: 200 });
        }
        controller.abort();
        return new Response(null, { status: 204 });
      },
      async runAgent(params) {
        captured = { sessionKey: params.sessionKey, idempotencyKey: params.idempotencyKey };
        return { kind: "silent" };
      },
    });
    await bridge.run(controller.signal);
    assert.ok(captured);
    return captured;
  }

  const admin = await capture("admin");
  const sales = await capture("sales");
  assert.notEqual(admin.sessionKey, sales.sessionKey);
  assert.notEqual(admin.idempotencyKey, sales.idempotencyKey);
  assert.match(admin.sessionKey, /whatsapp-agent:admin:direct:/);
  assert.match(sales.sessionKey, /whatsapp-agent:sales:direct:/);
});
