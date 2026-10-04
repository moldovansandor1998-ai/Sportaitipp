import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { replaceVideoVoice } from "./replaceVideoVoice";

interface SoundtrackOptions {
  sourceVideo?: Buffer;
  voiceId?: string;
  speechText?: string;
  hungarianTts?: boolean;
}

async function mux(video: Buffer, audio: Buffer, audioType: "mp3" | "mp4"): Promise<Buffer> {
  const binary = ffmpegPath;
  if (!binary) throw new Error("FFMPEG_UNAVAILABLE");
  const directory = await mkdtemp(join(tmpdir(), "castora-nureta-audio-"));
  try {
    const videoFile = join(directory, "generated.mp4");
    const audioFile = join(directory, `sound.${audioType}`);
    const output = join(directory, "output.mp4");
    await Promise.all([writeFile(videoFile, video), writeFile(audioFile, audio)]);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ["-hide_banner", "-loglevel", "error", "-y",
        "-i", videoFile, "-i", audioFile, "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-af", "apad",
        "-shortest", "-movflags", "+faststart", output]);
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-500); });
      child.on("error", reject);
      child.on("close", (code: number | null) => code === 0 ? resolve() : reject(new Error(`SOUNDTRACK_FAILED: ${stderr}`)));
    });
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Keep Nureta's video frames; replace only its audio after rendering. */
export async function addVideoSoundtrack(video: Buffer, options: SoundtrackOptions): Promise<Buffer> {
  if (options.sourceVideo) {
    if (options.voiceId)
      return replaceVideoVoice(video, options.voiceId, options.hungarianTts === true, options.sourceVideo);
    return mux(video, options.sourceVideo, "mp4");
  }
  if (!options.voiceId || !options.speechText?.trim() || !process.env.ELEVENLABS_API_KEY)
    throw new Error("MODELLHANG_SZÖVEG_HIÁNYZIK");
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ text: options.speechText.trim(), model_id: "eleven_v4", language_code: "hu" }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`ELEVENLABS_TTS_FAILED: ${response.status}`);
  return mux(video, Buffer.from(await response.arrayBuffer()), "mp3");
}
