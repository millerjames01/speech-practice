/**
 * Extracts one word's audio from a take, using the timestamps Scribe and
 * forced alignment return.
 *
 * Feedback on a failed word is built from templates rather than generated
 * prose, and "here is you saying it" next to "here is the model saying it" is
 * the most useful template we have.
 */

let ctx: AudioContext | null = null;

const audioContext = (): AudioContext => {
  ctx ??= new AudioContext();
  return ctx;
};

/** Decoding the same take once per word would be wasteful; cache per blob. */
const decoded = new WeakMap<Blob, Promise<AudioBuffer>>();

function decode(blob: Blob): Promise<AudioBuffer> {
  let promise = decoded.get(blob);
  if (!promise) {
    promise = blob.arrayBuffer().then((buf) => audioContext().decodeAudioData(buf));
    decoded.set(blob, promise);
  }
  return promise;
}

/** A little air either side, so a clipped slice does not sound like an error. */
const PAD_SECONDS = 0.06;

export async function sliceAudio(
  take: Blob,
  startSeconds: number,
  endSeconds: number,
): Promise<Blob> {
  const buffer = await decode(take);
  const start = Math.max(0, startSeconds - PAD_SECONDS);
  const end = Math.min(buffer.duration, endSeconds + PAD_SECONDS);
  if (end <= start) throw new Error('Empty audio slice');

  const startFrame = Math.floor(start * buffer.sampleRate);
  const frames = Math.max(1, Math.floor((end - start) * buffer.sampleRate));

  const out = new AudioBuffer({
    length: frames,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    out.copyToChannel(buffer.getChannelData(ch).subarray(startFrame, startFrame + frames), ch);
  }
  return encodeWav(out);
}

/** Re-encode as WAV: the only format we can write without a codec library. */
function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  const data = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      const sample = Math.max(-1, Math.min(1, data[ch]?.[i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
