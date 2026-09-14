import { createNativeChannel } from "./src/channel.ts";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { MEDIA_FFMPEG_MAX_AUDIO_DURATION_SECS, transcodeAudioBufferToOpus } from "openclaw/plugin-sdk/media-runtime";
import { describeImageFile, describeVideoFile, transcribeAudioFile } from "openclaw/plugin-sdk/media-understanding-runtime";
import { getDefaultLocalRoots, loadWebMediaRaw } from "openclaw/plugin-sdk/web-media";
import { buildAgentMessage, type DownloadedMedia, type OutboundMedia, WhatsAppAgentAdminBridge } from "./src/bridge.ts";
import { readPluginAccounts, type PluginConfig } from "./src/config.ts";
import { collectOutboundMediaReferences, stripMediaReferencesFromText } from "./src/outbound.ts";

const MAX_OUTBOUND_MEDIA_BYTES = 16 * 1024 * 1024;

export default definePluginEntry({
  id: "whatsapp-agent-admin",
  name: "WhatsApp Agent Platform",
  description: "Private text and media bridge from Meta's WhatsApp Agent Platform to any OpenClaw agent",
  register(api) {
    api.registerChannel({ plugin: createNativeChannel(api, loadGeneratedMedia, understandAttachment) });
    if (api.registrationMode !== "full" || api.pluginConfig?.transport === "channel") return;
    const accounts = readPluginAccounts(api.pluginConfig, api.config);
    for (const config of accounts) registerAccountService(api, config);
  },
});

function registerAccountService(
  api: Parameters<Parameters<typeof definePluginEntry>[0]["register"]>[0],
  config: PluginConfig,
): void {
  let controller: AbortController | undefined;
  let worker: Promise<void> | undefined;
  const accountLabel = config.accountId ?? "legacy";

  api.registerService({
    id: `whatsapp-agent-admin-poller-${accountLabel}`,
    reload: { configPrefixes: ["plugins.entries.whatsapp-agent-admin"] },
    start(ctx) {
      controller = new AbortController();
      const bridge = new WhatsAppAgentAdminBridge({
        token: config.apiToken,
        ...(config.accountId ? { accountId: config.accountId } : {}),
        agentId: config.agentId,
        adminWorkspace: config.workspace,
        stateDir: ctx.stateDir,
        stateNamespace: config.stateNamespace,
        pollTimeoutSeconds: config.pollTimeoutSeconds,
        sessionMode: config.sessionMode,
        logger: api.logger,
        async runAgent(params) {
          let understanding: string | undefined;
          if (params.attachment) {
            try {
              understanding = await understandAttachment(params.attachment, {
                config: api.config,
                agentId: config.agentId,
                workspaceDir: config.workspace,
                sessionKey: params.sessionKey,
              });
            } catch (error) {
              api.logger.warn(`whatsapp-agent-admin[${accountLabel}] media understanding failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          const run = await api.runtime.subagent.run({
            sessionKey: params.sessionKey,
            message: buildAgentMessage(params.message, params.attachment, understanding),
            idempotencyKey: params.idempotencyKey,
            cwd: params.cwd,
            deliver: false,
          });
          const result = await api.runtime.subagent.waitForRun({ runId: run.runId, timeoutMs: 300_000 });
          if (result.status !== "ok") throw new Error(`${config.agentId} run ended with ${result.status}: ${result.error ?? "unknown error"}`);
          if (result.terminalReply?.disposition !== "visible") return { kind: "silent" as const };

          const history = await api.runtime.subagent.getSessionMessages({ sessionKey: params.sessionKey, limit: 100 });
          const refs = collectOutboundMediaReferences(history.messages, run.runId);
          const loaded = await loadGeneratedMedia(refs, {
            workspace: config.workspace,
            stateDir: ctx.stateDir,
            logger: api.logger,
          });
          return {
            kind: "visible" as const,
            text: stripMediaReferencesFromText(result.terminalReply.text, loaded.refs),
            ...(loaded.media.length ? { media: loaded.media } : {}),
          };
        },
      });
      worker = bridge.run(controller.signal).catch((error) => {
        ctx.serviceHealth?.reportFailure(error);
        api.logger.error(`whatsapp-agent-admin[${accountLabel}] stopped: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
    async stop() {
      controller?.abort();
      await worker;
      controller = undefined;
      worker = undefined;
    },
  });
}

export async function loadGeneratedMedia(
  refs: ReturnType<typeof collectOutboundMediaReferences>,
  context: {
    workspace: string;
    stateDir: string;
    logger: { warn(message: string): void };
  },
): Promise<{ media: OutboundMedia[]; refs: ReturnType<typeof collectOutboundMediaReferences> }> {
  const output: OutboundMedia[] = [];
  const loadedRefs: ReturnType<typeof collectOutboundMediaReferences> = [];
  const localRoots = [...getDefaultLocalRoots(), context.workspace, context.stateDir];
  for (const ref of refs) {
    try {
      const loaded = await loadWebMediaRaw(ref.url, {
        maxBytes: MAX_OUTBOUND_MEDIA_BYTES,
        localRoots,
        workspaceDir: context.workspace,
      });
      if (loaded.kind !== "audio" && loaded.kind !== "video") continue;
      const contentType = loaded.contentType ?? (loaded.kind === "audio" ? "audio/ogg" : "video/mp4");
      let buffer = loaded.buffer;
      let filename = loaded.fileName ?? (loaded.kind === "audio" ? "voice.ogg" : "video.mp4");
      let normalizedContentType = contentType;
      const voice = loaded.kind === "audio" && (ref.audioAsVoice || /(?:opus|ogg)/iu.test(contentType));
      if (loaded.kind === "audio" && voice && requiresVoiceTranscode(contentType, filename)) {
        buffer = await transcodeToVoiceOgg(buffer, filename);
        // The Agent Platform upload allowlist accepts the bare MIME type.
        // The stored object may later be reported as audio/ogg; codecs=opus.
        normalizedContentType = "audio/ogg";
        filename = replaceExtension(filename, ".ogg");
      }
      output.push({
        kind: loaded.kind,
        buffer,
        contentType: normalizedContentType,
        filename,
        ...(loaded.kind === "audio" ? { voice } : {}),
      });
      loadedRefs.push(ref);
    } catch (error) {
      context.logger.warn(`whatsapp-agent-admin outbound media load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { media: output, refs: loadedRefs };
}

function requiresVoiceTranscode(contentType: string, filename: string): boolean {
  return !/(?:audio\/ogg|opus)/iu.test(contentType) && !/\.(?:ogg|opus)$/iu.test(filename);
}

function replaceExtension(filename: string, extension: string): string {
  const base = filename.replace(/\.[^.]+$/u, "");
  return `${base || "voice"}${extension}`;
}

export function transcodeToVoiceOgg(input: Buffer, inputFileName = "audio"): Promise<Buffer> {
  return transcodeAudioBufferToOpus({
    audioBuffer: input,
    inputFileName,
    tempPrefix: "whatsapp-agent-voice-",
    outputFileName: "voice.ogg",
    maxDurationSeconds: MEDIA_FFMPEG_MAX_AUDIO_DURATION_SECS,
    sampleRateHz: 48_000,
    channels: 1,
    bitrate: "64k",
  });
}

export async function understandAttachment(
  attachment: DownloadedMedia,
  context: {
    config: Parameters<typeof transcribeAudioFile>[0]["cfg"];
    agentId: string;
    workspaceDir: string;
    sessionKey: string;
  },
): Promise<string | undefined> {
  const common = {
    filePath: attachment.path,
    cfg: context.config,
    agentId: context.agentId,
    workspaceDir: context.workspaceDir,
    mime: attachment.contentType,
  };
  if (attachment.kind === "audio") {
    return (await transcribeAudioFile({ ...common, language: "pt" })).text;
  }
  if (attachment.kind === "image" || attachment.kind === "sticker") {
    return (await describeImageFile({
      ...common,
      prompt: "Describe this image received through WhatsApp objectively, including any relevant visible text.",
      scopeContext: { sessionKey: context.sessionKey, channel: "whatsapp-agent", chatType: "direct" },
    })).text;
  }
  if (attachment.kind === "video") return (await describeVideoFile(common)).text;
  return undefined;
}
