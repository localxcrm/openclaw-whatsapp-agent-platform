export type OutboundMediaReference = {
  url: string;
  audioAsVoice: boolean;
};

type UnknownRecord = Record<string, unknown>;

export function collectOutboundMediaReferences(messages: unknown[], runId: string): OutboundMediaReference[] {
  const refs = new Map<string, boolean>();
  for (const value of messages) {
    if (!isRecord(value) || readRunId(value) !== runId) continue;
    collectFromDelivery(value.openclawDelivery, refs);
    collectFromReplyText(value, refs);
    if (value.role !== "toolResult") continue;
    collectFromToolResult(value, refs);
    if (Array.isArray(value.content)) {
      for (const block of value.content) collectFromToolResult(block, refs);
    }
  }
  return [...refs].map(([url, audioAsVoice]) => ({ url, audioAsVoice }));
}

function collectFromReplyText(value: UnknownRecord, refs: Map<string, boolean>): void {
  if (value.role !== "assistant") return;
  if (typeof value.text === "string") addMediaUrlsFromText(value.text, refs);
  if (!Array.isArray(value.content)) return;
  for (const block of value.content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      addMediaUrlsFromText(block.text, refs);
    }
  }
}

function addMediaUrlsFromText(text: string, refs: Map<string, boolean>): void {
  for (const match of text.matchAll(/(?:https?:\/\/|\/)[^\s<>"']+/giu)) {
    const url = match[0].replace(/[),.;!?]+$/u, "");
    const kind = classifyMediaUrl(url);
    if (!kind) continue;
    refs.set(url, (refs.get(url) ?? false) || kind === "audio");
  }
}

export function classifyMediaUrl(value: string): "audio" | "video" | undefined {
  let pathname: string;
  try {
    pathname = value.startsWith("http://") || value.startsWith("https://")
      ? new URL(value).pathname
      : value.split(/[?#]/u, 1)[0];
  } catch {
    return undefined;
  }
  const extension = pathname.toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1];
  if (extension && ["aac", "amr", "m4a", "mp3", "oga", "ogg", "opus", "wav"].includes(extension)) return "audio";
  if (extension && ["3gp", "m4v", "mov", "mp4", "webm"].includes(extension)) return "video";
  return undefined;
}

export function stripMediaReferencesFromText(text: string, refs: readonly OutboundMediaReference[]): string {
  let cleaned = text;
  for (const { url } of refs) {
    const escaped = escapeRegExp(url);
    cleaned = cleaned
      .replace(new RegExp(`!?\\[[^\\]]*\\]\\(\\s*${escaped}\\s*\\)`, "gu"), "")
      .replace(new RegExp(`(?:^|\\n)\\s*MEDIA:\\s*${escaped}\\s*(?=\\n|$)`, "gu"), "\n")
      .replace(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*(?=\\n|$)`, "gu"), "\n");
  }
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

function collectFromDelivery(value: unknown, refs: Map<string, boolean>): void {
  if (!isRecord(value)) return;
  const voice = value.audioAsVoice === true;
  addUrls(value.mediaUrl, voice, refs);
  addUrls(value.mediaUrls, voice, refs);
}

function collectFromToolResult(value: unknown, refs: Map<string, boolean>): void {
  if (!isRecord(value)) return;
  const candidates = [value, value.details, value.result];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const media = isRecord(candidate.media) ? candidate.media : candidate;
    if (media.outbound === false) continue;
    const voice = media.audioAsVoice === true;
    addUrls(media.media, voice, refs);
    addUrls(media.path, voice, refs);
    addUrls(media.url, voice, refs);
    addUrls(media.mediaUrl, voice, refs);
    addUrls(media.filePath, voice, refs);
    addUrls(media.fileUrl, voice, refs);
    addUrls(media.mediaUrls, voice, refs);
    if (Array.isArray(media.attachments)) {
      for (const attachment of media.attachments) collectFromToolResult(attachment, refs);
    }
  }
}

function addUrls(value: unknown, voice: boolean, refs: Map<string, boolean>): void {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (typeof item !== "string" || !item.trim()) continue;
    const url = item.trim();
    refs.set(url, (refs.get(url) ?? false) || voice);
  }
}

function readRunId(value: UnknownRecord): string | undefined {
  const metadata = value.__openclaw;
  return isRecord(metadata) && typeof metadata.runId === "string" ? metadata.runId : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
