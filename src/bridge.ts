import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const API_BASE = "https://api.whatsapp.com/agent/v1";
const MAX_TEXT_LENGTH = 4096;
const MAX_HANDLED = 1_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MAX_OUTBOUND_MEDIA = 4;
const MAX_VIDEO_CAPTION_LENGTH = 1024;
const TYPING_REFRESH_MS = 20_000;

export type SupportedMediaKind = "audio" | "document" | "image" | "sticker" | "video";

type InboundMediaPayload = {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
  animated?: boolean;
};

export type DownloadedMedia = {
  kind: SupportedMediaKind;
  path: string;
  contentType?: string;
  filename?: string;
  caption?: string;
  voice?: boolean;
  size: number;
};

export type BridgeState = {
  offset?: string;
  handled: Record<string, { status: "sending" | "sent" | "unknown" | "failed" | "skipped"; at: string; outboundId?: string }>;
};

export type InboundMessage = {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  audio?: InboundMediaPayload;
  document?: InboundMediaPayload;
  image?: InboundMediaPayload;
  sticker?: InboundMediaPayload;
  video?: InboundMediaPayload;
};

export type UpdatesPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: { messages?: InboundMessage[] };
    }>;
  }>;
  next_offset?: string | number;
};

export type OutboundMedia = {
  kind: "audio" | "video";
  buffer: Buffer;
  contentType: string;
  filename: string;
  voice?: boolean;
};

export type AgentReply = { kind: "visible"; text: string; media?: OutboundMedia[] } | { kind: "silent" };

export type BridgeOptions = {
  token: string;
  accountId?: string;
  agentId: string;
  adminWorkspace: string;
  stateDir: string;
  stateNamespace?: string;
  pollTimeoutSeconds: number;
  sessionMode?: "isolated" | "main";
  fetchImpl?: typeof fetch;
  runAgent: (params: {
    sessionKey: string;
    senderId: string;
    messageId: string;
    message: string;
    attachment?: DownloadedMedia;
    idempotencyKey: string;
    cwd: string;
  }) => Promise<AgentReply>;
  logger: { info(message: string): void; warn(message: string): void; error(message: string): void };
};

class HttpError extends Error {
  readonly status: number;
  readonly code: number | undefined;

  constructor(status: number, code: number | undefined, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function safeSessionKey(agentId: string, participant: string, accountId?: string): string {
  const digest = createHash("sha256").update(participant).digest("hex").slice(0, 24);
  const accountSegment = accountId ? `${sanitizeId(accountId)}:` : "";
  return `agent:${agentId}:whatsapp-agent:${accountSegment}direct:${digest}`;
}

export function resolveSessionKey(options: Pick<BridgeOptions, "agentId" | "accountId" | "sessionMode">, participant: string): string {
  return options.sessionMode === "main"
    ? `agent:${options.agentId}:main`
    : safeSessionKey(options.agentId, participant, options.accountId);
}

export function extractMessages(payload: UpdatesPayload): InboundMessage[] {
  const messages: InboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) messages.push(...(change.value?.messages ?? []));
  }
  return messages;
}

export function normalizeReply(text: string): string {
  const value = text.trim();
  if (value.length <= MAX_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_TEXT_LENGTH - 1)}…`;
}

export function normalizeApiToken(token: string): string {
  const value = token.trim().replace(/^Bearer(?:\s+|$)/i, "").trim();
  if (!value) throw new Error("whatsapp-agent-admin requires a non-empty apiToken");
  return value;
}

export function buildAgentMessage(message: string, attachment?: DownloadedMedia, understanding?: string): string {
  if (!attachment) return message;
  const labels: Record<SupportedMediaKind, string> = {
    audio: "áudio",
    document: "documento",
    image: "imagem",
    sticker: "figurinha",
    video: "vídeo",
  };
  return [
    `[Anexo do WhatsApp: ${labels[attachment.kind]}]`,
    attachment.filename ? `Nome original: ${attachment.filename}` : undefined,
    attachment.contentType ? `Tipo: ${attachment.contentType}` : undefined,
    `Arquivo local: ${attachment.path}`,
    understanding ? `Conteúdo extraído automaticamente:\n${understanding}` : undefined,
    message.trim() ? `Mensagem/legenda do usuário:\n${message.trim()}` : undefined,
    "Analise o anexo e responda ao usuário. Não revele o caminho local do arquivo na resposta.",
  ].filter(Boolean).join("\n");
}

function compactHandled(handled: BridgeState["handled"]): BridgeState["handled"] {
  const entries = Object.entries(handled);
  if (entries.length <= MAX_HANDLED) return handled;
  return Object.fromEntries(entries.sort((a, b) => a[1].at.localeCompare(b[1].at)).slice(-MAX_HANDLED));
}

export class WhatsAppAgentAdminBridge {
  private readonly fetchImpl: typeof fetch;
  private readonly statePath: string;
  private readonly options: BridgeOptions;

  constructor(options: BridgeOptions) {
    this.options = { ...options, token: normalizeApiToken(options.token) };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.statePath = join(options.stateDir, options.stateNamespace ?? "whatsapp-agent-platform", "state.json");
  }

  async run(signal: AbortSignal): Promise<void> {
    let state = await this.loadState();
    let backoffMs = 1_000;
    while (!signal.aborted) {
      try {
        const payload = await this.poll(state.offset, signal);
        if (!payload) continue;
        for (const message of extractMessages(payload)) {
          try {
            state = await this.handleMessage(state, message, signal);
          } catch (error) {
            if (!state.handled[message.id]) {
              state.handled[message.id] = { status: "failed", at: new Date().toISOString() };
              await this.saveState(state);
            }
            this.options.logger.error(`WhatsApp Agent message ${message.id} failed: ${formatError(error)}`);
          }
        }
        if (payload.next_offset !== undefined) {
          state.offset = String(payload.next_offset);
          await this.saveState(state);
        }
        backoffMs = 1_000;
      } catch (error) {
        if (signal.aborted) return;
        const retryable = !(error instanceof HttpError) || [409, 429, 500, 503].includes(error.status);
        this.options.logger.error(`WhatsApp Agent poll failed: ${formatError(error)}`);
        if (!retryable) throw error;
        await delay(backoffMs, signal);
        backoffMs = Math.min(backoffMs * 2, 60_000);
      }
    }
  }

  private async poll(offset: string | undefined, signal: AbortSignal): Promise<UpdatesPayload | undefined> {
    const url = new URL(`${API_BASE}/updates`);
    url.searchParams.set("limit", "50");
    url.searchParams.set("timeout", String(this.options.pollTimeoutSeconds));
    if (offset !== undefined) url.searchParams.set("offset", offset);
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.options.token}` },
      signal,
    });
    if (response.status === 204) return undefined;
    if (!response.ok) throw await toHttpError(response);
    return (await response.json()) as UpdatesPayload;
  }

  private async handleMessage(state: BridgeState, message: InboundMessage, signal: AbortSignal): Promise<BridgeState> {
    if (!message.id || state.handled[message.id]) return state;
    if (!message.from?.startsWith("user:")) {
      state.handled[message.id] = { status: "skipped", at: new Date().toISOString() };
      await this.saveState(state);
      return state;
    }
    const mediaKind = isSupportedMediaKind(message.type) ? message.type : undefined;
    const mediaPayload = mediaKind ? message[mediaKind] : undefined;
    const text = message.type === "text" ? message.text?.body?.trim() ?? "" : mediaPayload?.caption?.trim() ?? "";
    if ((message.type === "text" && !text) || (message.type !== "text" && !mediaKind)) {
      state.handled[message.id] = { status: "skipped", at: new Date().toISOString() };
      await this.saveState(state);
      return state;
    }

    await this.sendTypingStatus(message.id, signal);
    const stopTyping = this.startTypingRefresh(message.id, signal);
    try {
      let attachment: DownloadedMedia | undefined;
      if (mediaKind) {
        if (!mediaPayload?.id) throw new Error(`${mediaKind} message ${message.id} has no media id`);
        attachment = await this.downloadMedia(message.id, mediaKind, mediaPayload, signal);
      }

      const reply = await this.options.runAgent({
        sessionKey: resolveSessionKey(this.options, message.from),
        senderId: message.from,
        messageId: message.id,
        message: text,
        ...(attachment ? { attachment } : {}),
        idempotencyKey: `whatsapp-agent-admin:${this.options.accountId ? `${this.options.accountId}:` : ""}${message.id}`,
        cwd: this.options.adminWorkspace,
      });
      if (reply.kind === "silent" || (!reply.text.trim() && !reply.media?.length)) {
        state.handled[message.id] = { status: "skipped", at: new Date().toISOString() };
        await this.saveState(state);
        return state;
      }

      state.handled[message.id] = { status: "sending", at: new Date().toISOString() };
      await this.saveState(state);
      try {
        const outboundId = await this.sendReply(message.from, reply, signal);
        state.handled[message.id] = { status: "sent", at: new Date().toISOString(), outboundId };
        this.options.logger.info(`WhatsApp Agent reply sent for inbound ${message.id}`);
      } catch (error) {
        const definitelyRejected = error instanceof HttpError
          && error.status >= 400
          && error.status < 500
          && error.status !== 429;
        state.handled[message.id] = { status: definitelyRejected ? "failed" : "unknown", at: new Date().toISOString() };
        await this.saveState(state);
        throw error;
      }
      await this.saveState(state);
      return state;
    } finally {
      stopTyping();
    }
  }

  private async downloadMedia(
    messageId: string,
    kind: SupportedMediaKind,
    media: InboundMediaPayload,
    signal: AbortSignal,
  ): Promise<DownloadedMedia> {
    const metadataResponse = await this.fetchImpl(`${API_BASE}/media/${encodeURIComponent(media.id ?? "")}`, {
      headers: { Authorization: `Bearer ${this.options.token}` },
      signal,
    });
    if (!metadataResponse.ok) throw await toHttpError(metadataResponse);
    const metadata = (await metadataResponse.json()) as {
      url?: string;
      mime_type?: string;
      sha256?: string;
      file_size?: number;
    };
    if (!metadata.url) throw new Error(`media ${media.id} metadata has no download URL`);
    assertTrustedMediaUrl(metadata.url);

    const maxBytes = kind === "image" || kind === "sticker" ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES;
    if (typeof metadata.file_size === "number" && metadata.file_size > maxBytes) {
      throw new Error(`${kind} attachment exceeds ${maxBytes} bytes`);
    }
    const downloadResponse = await this.fetchImpl(metadata.url, {
      headers: { Authorization: `Bearer ${this.options.token}` },
      signal,
    });
    if (!downloadResponse.ok) throw await toHttpError(downloadResponse);
    const buffer = await readResponseWithLimit(downloadResponse, maxBytes);
    const expectedHash = media.sha256 ?? metadata.sha256;
    if (expectedHash && !hashMatches(buffer, expectedHash)) throw new Error(`media ${media.id} failed SHA-256 validation`);

    const contentType = media.mime_type ?? metadata.mime_type ?? downloadResponse.headers.get("content-type") ?? undefined;
    const filename = sanitizeFilename(media.filename, messageId, contentType);
    const mediaDir = join(dirname(this.statePath), "media");
    await mkdir(mediaDir, { recursive: true, mode: 0o700 });
    const destination = join(mediaDir, `${sanitizeId(messageId)}-${filename}`);
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, buffer, { mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return {
      kind,
      path: destination,
      ...(contentType ? { contentType } : {}),
      ...(media.filename ? { filename: basename(media.filename) } : {}),
      ...(media.caption ? { caption: media.caption } : {}),
      ...(media.voice !== undefined ? { voice: media.voice } : {}),
      size: buffer.length,
    };
  }

  private async sendTypingStatus(messageId: string, signal: AbortSignal): Promise<void> {
    try {
      const response = await this.fetchImpl(`${API_BASE}/statuses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
        signal,
      });
      if (!response.ok) throw await toHttpError(response);
    } catch (error) {
      if (!signal.aborted) this.options.logger.warn(`WhatsApp Agent typing status failed: ${formatError(error)}`);
    }
  }

  private startTypingRefresh(messageId: string, signal: AbortSignal): () => void {
    const timer = setInterval(() => void this.sendTypingStatus(messageId, signal), TYPING_REFRESH_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async sendText(to: string, body: string, signal: AbortSignal): Promise<string | undefined> {
    const response = await this.fetchImpl(`${API_BASE}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
      signal,
    });
    if (!response.ok) throw await toHttpError(response);
    const payload = (await response.json()) as { messages?: Array<{ id?: string }> };
    return payload.messages?.[0]?.id;
  }

  async sendReply(to: string, reply: Extract<AgentReply, { kind: "visible" }>, signal: AbortSignal): Promise<string | undefined> {
    const media = (reply.media ?? []).slice(0, MAX_OUTBOUND_MEDIA);
    if (media.length === 0) return this.sendText(to, normalizeReply(reply.text), signal);

    let lastOutboundId: string | undefined;
    let textDelivered = false;
    for (const [index, item] of media.entries()) {
      const mediaId = await this.uploadMedia(item, signal);
      const caption = item.kind === "video" && !textDelivered && reply.text.trim()
        ? reply.text.trim().slice(0, MAX_VIDEO_CAPTION_LENGTH)
        : undefined;
      lastOutboundId = await this.sendMedia(to, item, mediaId, caption, signal);
      if (caption) textDelivered = true;
      this.options.logger.info(`WhatsApp Agent ${item.kind} ${index + 1}/${media.length} sent`);
    }
    if (!textDelivered && reply.text.trim()) {
      lastOutboundId = await this.sendText(to, normalizeReply(reply.text), signal);
    }
    return lastOutboundId;
  }

  private async uploadMedia(media: OutboundMedia, signal: AbortSignal): Promise<string> {
    if (media.buffer.length > MAX_MEDIA_BYTES) throw new Error(`outbound ${media.kind} exceeds ${MAX_MEDIA_BYTES} bytes`);
    const uploadContentType = normalizeOutboundContentType(media);
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", uploadContentType);
    form.set("file", new Blob([new Uint8Array(media.buffer)], { type: uploadContentType }), media.filename);
    const response = await this.fetchImpl(`${API_BASE}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.token}` },
      body: form,
      signal,
    });
    if (!response.ok) throw await toHttpError(response);
    const payload = (await response.json()) as { id?: string; media?: { id?: string } };
    const mediaId = payload.id ?? payload.media?.id;
    if (!mediaId) throw new Error(`WhatsApp Agent ${media.kind} upload returned no media id`);
    return mediaId;
  }

  private async sendMedia(
    to: string,
    media: OutboundMedia,
    mediaId: string,
    caption: string | undefined,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const mediaPayload = media.kind === "audio"
      ? { id: mediaId }
      : { id: mediaId, ...(caption ? { caption } : {}) };
    const response = await this.fetchImpl(`${API_BASE}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: media.kind, [media.kind]: mediaPayload }),
      signal,
    });
    if (!response.ok) throw await toHttpError(response);
    const payload = (await response.json()) as { messages?: Array<{ id?: string }> };
    return payload.messages?.[0]?.id;
  }

  private async loadState(): Promise<BridgeState> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<BridgeState>;
      const handled = parsed.handled && typeof parsed.handled === "object" ? parsed.handled : {};
      for (const [id, item] of Object.entries(handled)) {
        if (item.status === "sending") handled[id] = { ...item, status: "unknown" };
      }
      return { ...(parsed.offset === undefined ? {} : { offset: String(parsed.offset) }), handled };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { handled: {} };
    }
  }

  private async saveState(state: BridgeState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
    const next = { ...state, handled: compactHandled(state.handled) };
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, this.statePath);
  }
}

function isSupportedMediaKind(value: string): value is SupportedMediaKind {
  return value === "audio" || value === "document" || value === "image" || value === "sticker" || value === "video";
}

function assertTrustedMediaUrl(value: string): void {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const trusted = hostname === "api.whatsapp.com"
    || hostname.endsWith(".fbcdn.net")
    || hostname.endsWith(".fbsbx.com")
    || hostname.endsWith(".whatsapp.net");
  if (url.protocol !== "https:" || !trusted) throw new Error(`untrusted WhatsApp media download host: ${hostname}`);
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "message";
}

function sanitizeFilename(filename: string | undefined, messageId: string, contentType: string | undefined): string {
  const original = filename ? basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_") : "";
  if (original && original !== "." && original !== "..") return original.slice(-180);
  return `${sanitizeId(messageId)}${extensionForContentType(contentType)}`;
}

function extensionForContentType(contentType: string | undefined): string {
  const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  const extensions: Record<string, string> = {
    "application/pdf": ".pdf",
    "audio/aac": ".aac",
    "audio/amr": ".amr",
    "audio/m4a": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "text/plain": ".txt",
    "video/3gpp": ".3gp",
    "video/mp4": ".mp4",
  };
  return mime ? extensions[mime] ?? "" : "";
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error(`attachment exceeds ${maxBytes} bytes`);
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error(`attachment exceeds ${maxBytes} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function hashMatches(buffer: Buffer, expected: string): boolean {
  const digest = createHash("sha256").update(buffer).digest();
  const normalized = expected.trim();
  return digest.toString("hex").toLowerCase() === normalized.toLowerCase() || digest.toString("base64") === normalized;
}

async function toHttpError(response: Response): Promise<HttpError> {
  let code: number | undefined;
  let detail = `${response.status} ${response.statusText}`;
  try {
    const payload = (await response.json()) as { error?: { code?: number; message?: string; error_data?: { details?: string } } };
    code = payload.error?.code;
    if (payload.error?.message) detail = payload.error.message;
    if (payload.error?.error_data?.details) detail = `${detail}: ${payload.error.error_data.details}`;
  } catch {}
  return new HttpError(response.status, code, detail);
}

function normalizeOutboundContentType(media: OutboundMedia): string {
  const declared = media.contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (media.kind === "audio") {
    const accepted = new Set(["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg", "audio/opus"]);
    if (declared && accepted.has(declared)) return declared;
    throw new Error(`unsupported outbound audio MIME type: ${declared || "unknown"}`);
  }
  if (declared === "video/mp4" || declared === "video/3gpp") return declared;
  throw new Error(`unsupported outbound video MIME type: ${declared || "unknown"}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
