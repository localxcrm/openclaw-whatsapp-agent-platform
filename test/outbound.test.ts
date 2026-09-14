import assert from "node:assert/strict";
import test from "node:test";
import { collectOutboundMediaReferences, stripMediaReferencesFromText } from "../src/outbound.ts";

test("collects only media produced by the current agent run", () => {
  const messages = [
    {
      role: "assistant",
      __openclaw: { runId: "old-run" },
      openclawDelivery: { mediaUrls: ["/media/old.opus"], audioAsVoice: true },
    },
    {
      role: "assistant",
      __openclaw: { runId: "current-run" },
      openclawDelivery: { mediaUrls: ["/media/voice.opus"], audioAsVoice: true },
    },
    {
      role: "toolResult",
      __openclaw: { runId: "current-run" },
      content: [{ details: { media: { mediaUrls: ["https://cdn.example/video.mp4"] } } }],
    },
  ];

  assert.deepEqual(collectOutboundMediaReferences(messages, "current-run"), [
    { url: "/media/voice.opus", audioAsVoice: true },
    { url: "https://cdn.example/video.mp4", audioAsVoice: false },
  ]);
});

test("removes delivered media links while preserving the reply caption", () => {
  const refs = [
    { url: "/media/voice.opus", audioAsVoice: true },
    { url: "https://cdn.example/video.mp4", audioAsVoice: false },
  ];
  const text = [
    "Aqui está o resultado.",
    "[Ouvir áudio](/media/voice.opus)",
    "MEDIA:https://cdn.example/video.mp4",
  ].join("\n");

  assert.equal(stripMediaReferencesFromText(text, refs), "Aqui está o resultado.");
});

test("detects HeyGen WAV and video links in the current final assistant reply", () => {
  const messages = [
    {
      role: "assistant",
      __openclaw: { runId: "current-run" },
      content: [{
        type: "text",
        text: "🎧 [Ouvir áudio](https://resource2.heygen.ai/text_to_speech/job/id=voice.wav)\n\n[Ver vídeo](https://cdn.example/render.mp4)",
      }],
    },
  ];

  const refs = collectOutboundMediaReferences(messages, "current-run");
  assert.deepEqual(refs, [
    { url: "https://resource2.heygen.ai/text_to_speech/job/id=voice.wav", audioAsVoice: true },
    { url: "https://cdn.example/render.mp4", audioAsVoice: false },
  ]);
  assert.equal(
    stripMediaReferencesFromText((messages[0].content[0] as { text: string }).text, refs),
    "🎧",
  );
});
