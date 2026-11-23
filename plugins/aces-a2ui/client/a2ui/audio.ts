/**
 * Bridge between A2UI's `AudioPlayer` (a URL) and Paseo's `client.playAudio`
 * (base64 + mimeType). The client context is captured once by index.client.tsx.
 */

import { isValidMediaUrl } from "./media-url";

export interface PlayAudioSource {
  base64: string;
  mimeType: string;
}

type PlayAudio = (source: PlayAudioSource) => Promise<void>;

let playAudio: PlayAudio | null = null;

/** Called once from the plugin's client contribution. */
export function setPlayAudio(fn: PlayAudio): void {
  playAudio = fn;
}

/** Loads the URL (data: URI directly, remote via fetch) and plays it through Paseo. */
export async function playAudioFromUrl(url: string): Promise<void> {
  if (!playAudio) throw new Error("Audio playback is unavailable on this client.");
  // Spec-mandated media URL allowlist (see media-url.ts) before any fetch.
  if (!isValidMediaUrl(url)) throw new Error("Unsupported audio URL.");
  const source = await toPlayAudioSource(url);
  await playAudio(source);
}

async function toPlayAudioSource(url: string): Promise<PlayAudioSource> {
  const data = /^data:([^;,]*)+(;base64)?,(.*)$/s.exec(url);
  if (data) {
    if (!data[2]) throw new Error("Only base64 data: URLs are supported for audio.");
    return { base64: data[3], mimeType: data[1] || "audio/mpeg" };
  }
  if (!/^https?:\/\//i.test(url)) throw new Error(`Unsupported audio URL: ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type") ?? guessAudioMime(url);
  return { base64: bytesToBase64(bytes), mimeType };
}

function guessAudioMime(url: string): string {
  if (/\.mp3(\?|$)/i.test(url)) return "audio/mpeg";
  if (/\.wav(\?|$)/i.test(url)) return "audio/wav";
  if (/\.ogg(\?|$)/i.test(url)) return "audio/ogg";
  if (/\.m4a(\?|$)/i.test(url)) return "audio/mp4";
  return "audio/mpeg";
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** RN has no Buffer/btoa; a plain table encoder is the portable option. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : BASE64_CHARS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : BASE64_CHARS[b2 & 63];
  }
  return out;
}
