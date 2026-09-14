import assert from "node:assert/strict";
import test from "node:test";
import { transcodeToVoiceOgg } from "../index.ts";

function createSilentWav(sampleRate = 8_000, durationMs = 100): Buffer {
  const samples = Math.floor(sampleRate * durationMs / 1_000);
  const pcm = Buffer.alloc(samples * 2);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

test("transcodes WAV output into native WhatsApp OGG/Opus voice audio", async () => {
  const output = await transcodeToVoiceOgg(createSilentWav(), "heygen.wav");
  assert.equal(output.subarray(0, 4).toString("ascii"), "OggS");
  assert.ok(output.includes(Buffer.from("OpusHead")));
});
