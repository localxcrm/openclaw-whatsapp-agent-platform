import type { ChannelPlugin, OpenClawPluginApi, OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { dispatchInboundReplyWithBase } from "openclaw/plugin-sdk/inbound-reply-dispatch";
import { readPluginAccounts, type PluginConfig } from "./config.ts";
import { buildAgentMessage, WhatsAppAgentAdminBridge } from "./bridge.ts";
import { collectOutboundMediaReferences, stripMediaReferencesFromText } from "./outbound.ts";
import type { understandAttachment } from "../index.ts";
import type { loadGeneratedMedia } from "../index.ts";

export const CHANNEL_ID = "whatsapp-agent";
type Account = { accountId: string; enabled: boolean; configured: boolean };
function settings(cfg: OpenClawConfig): Record<string, unknown> {
  return cfg.plugins?.entries?.["whatsapp-agent-admin"]?.config ?? {};
}
export function inspectAccounts(cfg: OpenClawConfig): Account[] {
  const config = settings(cfg);
  const entries: Array<[string, unknown]> = config.accounts && typeof config.accounts === "object"
    ? Object.entries(config.accounts) : [["default", config]];
  return entries.map(([accountId, value]) => {
    const account = value as Record<string, unknown>;
    return { accountId, enabled: config.transport === "channel" && account.enabled !== false,
      configured: Boolean(account.apiToken) };
  });
}
export function createNativeChannel(api: OpenClawPluginApi, loadMedia: typeof loadGeneratedMedia, understand: typeof understandAttachment, dispatch = dispatchInboundReplyWithBase): ChannelPlugin<Account> {
  const live = new Map<string, { bridge: WhatsAppAgentAdminBridge; config: PluginConfig; signal: AbortSignal }>();
  const stopped = new Set<string>();
  const getAccount = (cfg: OpenClawConfig, id?: string | null): Account => {
    const accounts = inspectAccounts(cfg);
    if (!id && accounts.length !== 1) throw new Error("Select a WhatsApp Agent account explicitly");
    return accounts.find(a => a.accountId === (id ?? accounts[0]?.accountId))
      ?? { accountId: id ?? "default", enabled: false, configured: false };
  };
  async function send(ctx: Parameters<NonNullable<NonNullable<ChannelPlugin<Account>["outbound"]>["sendText"]>>[0]) {
    const account = getAccount(ctx.cfg, ctx.accountId);
    const active = live.get(account.accountId);
    if (!account.enabled || (!active && stopped.has(account.accountId))) throw new Error("WhatsApp Agent account is not running");
    if (!/^user:[^\s]+$/u.test(ctx.to)) throw new Error("WhatsApp Agent requires an exact user: recipient");
    const config = active?.config ?? readPluginAccounts(api.pluginConfig, ctx.cfg)
      .find(candidate => (candidate.accountId ?? "default") === account.accountId);
    if (!config) throw new Error("WhatsApp Agent account configuration unavailable");
    const fallbackController = active ? undefined : new AbortController();
    const accountSignal = active?.signal ?? fallbackController!.signal;
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, accountSignal]) : accountSignal;
    signal.throwIfAborted();
    const media = ctx.mediaUrl ? await loadMedia([{ url: ctx.mediaUrl, audioAsVoice: ctx.audioAsVoice === true }], {
      workspace: config.workspace, stateDir: api.runtime.state.resolveStateDir(), logger: api.logger,
    }) : { media: [], refs: [] };
    if (ctx.mediaUrl && !media.media.length) throw new Error("Media could not be loaded as supported audio/video");
    await ctx.onPlatformSendDispatch?.();
    ctx.assertDirectAdapterHandoff?.();
    const bridge = active?.bridge ?? new WhatsAppAgentAdminBridge({
      token: config.apiToken, accountId: config.accountId, agentId: config.agentId,
      adminWorkspace: config.workspace, stateDir: api.runtime.state.resolveStateDir(),
      stateNamespace: config.stateNamespace, pollTimeoutSeconds: config.pollTimeoutSeconds,
      sessionMode: config.sessionMode, logger: api.logger,
      async runAgent() { throw new Error("Outbound-only bridge cannot run an agent"); },
    });
    const messageId = await bridge.sendReply(ctx.to, { kind: "visible", text: ctx.text, media: media.media }, signal);
    if (!messageId) throw new Error("WhatsApp Agent returned no delivery id");
    return { channel: CHANNEL_ID, messageId, chatId: ctx.to };
  }
  return {
    id: CHANNEL_ID,
    meta: { id: CHANNEL_ID, label: "WhatsApp Agent Platform", selectionLabel: "WhatsApp Agent (Meta)",
      docsPath: "/plugins/sdk-channel-plugins", blurb: "Meta Agent Platform — separate from WhatsApp Web" },
    capabilities: { chatTypes: ["direct"], media: true },
    reload: { configPrefixes: ["plugins.entries.whatsapp-agent-admin"] },
    config: {
      listAccountIds: cfg => inspectAccounts(cfg).map(a => a.accountId),
      resolveAccount: getAccount, inspectAccount: getAccount,
      isEnabled: account => account.enabled, isConfigured: account => account.configured,
      describeAccount: account => ({ ...account }),
    },
    outbound: { deliveryMode: "direct", textChunkLimit: 4096, sendText: send, sendMedia: send },
    gateway: {
      async startAccount(ctx) {
        if (!ctx.account.enabled) return;
        stopped.delete(ctx.accountId);
        if (live.has(ctx.accountId)) throw new Error("WhatsApp Agent poller already running");
        const config = readPluginAccounts(api.pluginConfig, ctx.cfg).find(a => (a.accountId ?? "default") === ctx.accountId);
        if (!config) throw new Error("WhatsApp Agent account configuration unavailable");
        const core = api.runtime;
        const stateDir = core.state.resolveStateDir();
        const bridge = new WhatsAppAgentAdminBridge({
          token: config.apiToken, accountId: config.accountId, agentId: config.agentId,
          adminWorkspace: config.workspace, stateDir, stateNamespace: config.stateNamespace,
          pollTimeoutSeconds: config.pollTimeoutSeconds, sessionMode: config.sessionMode, logger: api.logger,
          async runAgent(params) {
            const route = core.channel.routing.resolveAgentRoute({ cfg: ctx.cfg, channel: CHANNEL_ID,
              accountId: ctx.accountId, defaultAgentId: config.agentId,
              peer: { kind: "direct", id: params.senderId },
              dmScope: config.sessionMode === "main" ? "main" : "per-account-channel-peer" });
            let understanding: string | undefined;
            if (params.attachment) {
              try { understanding = await understand(params.attachment, { config: ctx.cfg, agentId: route.agentId, workspaceDir: config.workspace, sessionKey: route.sessionKey }); }
              catch { api.logger.warn("WhatsApp Agent media understanding unavailable"); }
            }
            const payload = core.channel.reply.finalizeInboundContext({
              Body: buildAgentMessage(params.message, params.attachment, understanding),
              BodyForAgent: buildAgentMessage(params.message, params.attachment, understanding),
              RawBody: params.message, CommandBody: params.message,
              From: params.senderId, To: ctx.accountId, SenderId: params.senderId,
              MessageSid: params.messageId, SessionKey: route.sessionKey,
              AccountId: ctx.accountId, Provider: CHANNEL_ID, Surface: CHANNEL_ID,
              OriginatingChannel: CHANNEL_ID, OriginatingTo: params.senderId,
              ChatType: "direct", CommandAuthorized: false,
            });
            const texts: string[] = [];
            const refs: Parameters<typeof loadMedia>[0] = [];
            await dispatch({ cfg: ctx.cfg, channel: CHANNEL_ID, accountId: ctx.accountId,
              route, storePath: core.channel.session.resolveStorePath(ctx.cfg.session?.store, { agentId: route.agentId }),
              ctxPayload: payload, core, durable: false,
              deliver: async reply => {
                if (reply.text) texts.push(reply.text);
                for (const url of reply.mediaUrls ?? (reply.mediaUrl ? [reply.mediaUrl] : [])) refs.push({ url, audioAsVoice: false });
              },
              onRecordError: error => { throw error; }, onDispatchError: error => { throw error; },
            });
            refs.push(...collectOutboundMediaReferences([{ role: "assistant", text: texts.join("\n"), __openclaw: { runId: params.messageId } }], params.messageId));
            const uniqueRefs = [...new Map(refs.map(ref => [ref.url, ref])).values()];
            const media = await loadMedia(uniqueRefs, { workspace: config.workspace, stateDir, logger: api.logger });
            ctx.setStatus({ ...ctx.getStatus(), lastInboundAt: Date.now() });
            return texts.length || media.media.length ? { kind: "visible", text: stripMediaReferencesFromText(texts.join("\n\n"), media.refs), media: media.media } : { kind: "silent" };
          },
        });
        live.set(ctx.accountId, { bridge, config, signal: ctx.abortSignal });
        ctx.setStatus({ ...ctx.getStatus(), running: true, lastStartAt: Date.now() });
        try { await bridge.run(ctx.abortSignal); }
        finally {
          live.delete(ctx.accountId);
          stopped.add(ctx.accountId);
          ctx.setStatus({ ...ctx.getStatus(), running: false, lastStopAt: Date.now() });
        }
      },
    },
  };
}
