/** Playback helpers shared by every view, including the 0.75x model-audio rate. */

import { getLineAudio } from './cache';
import { config } from '../config';

let current: HTMLAudioElement | null = null;

export function stopPlayback(): void {
  if (current) {
    current.pause();
    current.src = '';
    current = null;
  }
}

export function playBlob(blob: Blob, rate = 1): Promise<void> {
  stopPlayback();
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = rate;
    current = audio;
    const done = () => {
      URL.revokeObjectURL(url);
      if (current === audio) current = null;
      resolve();
    };
    audio.onended = done;
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Audio playback failed'));
    };
    void audio.play().catch(reject);
  });
}

/** Plays a scripted line, generating and caching its audio on first use. */
export async function playLine(text: string, voiceId: string, slow = false): Promise<void> {
  const blob = await getLineAudio(text, voiceId);
  await playBlob(blob, slow ? config.ui.slowPlaybackRate : 1);
}
