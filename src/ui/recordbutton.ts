/** Push-to-talk control shared by every phase. */

import { Recorder } from '../audio/recorder';
import { el } from './dom';

export interface RecordControl {
  node: HTMLElement;
  setDisabled(disabled: boolean): void;
  setLabel(label: string): void;
}

export function recordButton(
  onTake: (audio: Blob) => Promise<void> | void,
  idleLabel = 'Hold to speak',
): RecordControl {
  const recorder = new Recorder();
  const btn = el('button', { class: 'btn record', type: 'button' }, idleLabel);
  let busy = false;

  const start = async () => {
    if (busy || recorder.recording) return;
    try {
      await recorder.start();
      btn.classList.add('recording');
      btn.textContent = 'Recording — release to stop';
    } catch {
      btn.textContent = 'Microphone unavailable';
    }
  };

  const stop = async () => {
    if (!recorder.recording) return;
    busy = true;
    btn.classList.remove('recording');
    btn.textContent = 'Checking…';
    try {
      const audio = await recorder.stop();
      await onTake(audio);
    } finally {
      busy = false;
      btn.textContent = idleLabel;
    }
  };

  btn.addEventListener('pointerdown', () => void start());
  btn.addEventListener('pointerup', () => void stop());
  btn.addEventListener('pointerleave', () => void stop());

  return {
    node: btn,
    setDisabled: (disabled) => {
      btn.disabled = disabled;
    },
    setLabel: (label) => {
      btn.textContent = label;
    },
  };
}
