import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

async function ffmpeg(args: string[]): Promise<void> {
  const binary = ffmpegPath;
  if (!binary) throw new Error("FFMPEG_UNAVAILABLE");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-1000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`FFMPEG_FAILED: ${stderr}`)));
  });
}

/** Replace only the soundtrack. The video frames are stream-copied without regeneration. */
export async function replaceVideoVoice(video: Buffer, voiceId: string, hungarianTts = false): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !voiceId) throw new Error("ELEVENLABS_VOICE_NOT_CONFIGURED");
  const directory = await mkdtemp(join(tmpdir(), "castora-voice-"));
  try {
    const input = join(directory, "input.mp4");
    const speech = join(directory, "speech.wav");
    const converted = join(directory, "converted.mp3");
    const output = join(directory, "output.mp4");
    await writeFile(input, video);
    await ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", "44100", speech]);
    let response: Response;
    if (hungarianTts) {
      const form = new FormData();
      form.append("file", new Blob([await readFile(speech)], { type: "audio/wav" }), "speech.wav");
      form.append("model_id", "scribe_v2");
      form.append("language_code", "hun");
      const transcriptResponse = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: AbortSignal.timeout(180_000),
      });
      if (!transcriptResponse.ok) throw new Error(`ELEVENLABS_TRANSCRIPT_FAILED: ${transcriptResponse.status}`);
      const transcript = await transcriptResponse.json() as { text?: string };
      const words = transcript.text?.trim();
      if (!words) throw new Error("ELEVENLABS_TRANSCRIPT_EMPTY");
      response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: "POST", headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ text: words, model_id: "eleven_v4", language_code: "hu" }),
        signal: AbortSignal.timeout(180_000),
      });
    } else {
      const form = new FormData();
      form.append("audio", new Blob([await readFile(speech)], { type: "audio/wav" }), "speech.wav");
      form.append("model_id", "eleven_multilingual_sts_v2");
      response = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: AbortSignal.timeout(180_000),
      });
    }
    if (!response.ok) throw new Error(`ELEVENLABS_VOICE_FAILED: ${response.status}`);
    await writeFile(converted, Buffer.from(await response.arrayBuffer()));
    await ffmpeg(["-i", input, "-i", converted, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-af", "apad", "-shortest", "-movflags", "+faststart", output]);
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
