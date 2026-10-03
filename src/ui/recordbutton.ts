/** Push-to-talk control shared by every phase. */

import { Recorder } from '../audio/recorder';
import { el } from './dom';

export interface RecordControl {
  node: HTMLElement;
  setDisabled(disabled: boolean): void;
  setLabel(label: string): void;
}

/**
 * Below this, the take is silence or a stray click rather than speech. Sending
 * it would earn a 400 from the transcriber and tell the learner nothing.
 */
const MIN_TAKE_BYTES = 2048;

export function recordButton(
  onTake: (audio: Blob) => Promise<void> | void,
  idleLabel = 'Hold to speak',
): RecordControl {
  const recorder = new Recorder();
  const btn = el('button', { class: 'btn record', type: 'button' }, idleLabel);
  let busy = false;
  /** In-flight start, so a release that beats getUserMedia still stops it. */
  let starting: Promise<void> | null = null;

  const setLabel = (text: string) => {
    btn.textContent = text;
  };

  const start = (event: PointerEvent) => {
    if (busy || starting || recorder.recording) return;
    // Capture the pointer so the button keeps receiving events even when the
    // layout shifts under the cursor - appending feedback below the button
    // used to move it away and fire pointerleave mid-take.
    try {
      btn.setPointerCapture(event.pointerId);
    } catch {
      // Not fatal; without capture we simply rely on pointerup.
    }
    starting = recorder
      .start()
      .then(() => {
        btn.classList.add('recording');
        setLabel('Recording — release to stop');
      })
      .catch(() => {
        setLabel('Microphone unavailable');
      })
      .finally(() => {
        starting = null;
      });
  };

  const stop = async (event?: PointerEvent) => {
    if (event !== undefined) {
      try {
        if (btn.hasPointerCapture(event.pointerId)) {
          btn.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Nothing to release.
      }
    }
    // A release can beat getUserMedia; wait for it rather than droppingit.
    if (starting) await starting;
    if (!recorder.recording) return;

    busy = true;
    btn.classList.remove('recording');
    setLabel('Checking…');
    try {
      const audio = await recorder.stop();
      if (audio.size < MIN_TAKE_BYTES) {
        setLabel('Didn’t catch that — hold the button while you speak');
        return;
      }
      await onTake(audio);
    } finally {
      busy = false;
      // Leave a "didn't catch that" nudge up rather than overwriting it.
      if (btn.textContent === 'Checking…') setLabel(idleLabel);
      setTimeout(() => {
        if (!recorder.recording && !busy) setLabel(idleLabel);
      }, 2500);
    }
  };

  btn.addEventListener('pointerdown', (e) => start(e));
  btn.addEventListener('pointerup', (e) => void stop(e));
  // Deliberately NOT pointerleave: with pointer capture the button follows the
  // cursor, and a reflow that moves the button must not end the take.
  btn.addEventListener('pointercancel', (e) => void stop(e));

  return {
    node: btn,
    setDisabled: (disabled) => {
      btn.disabled = disabled;
    },
    setLabel,
  };
}
