/**
 * Settings modal. Asks for keys on load; nothing is stored unless "remember for
 * this tab" is ticked, and that only reaches sessionStorage.
 */

import { config } from '../config';
import { getSettings, isRemembering, setSettings, type LlmProvider } from '../keys';
import { button, el } from './dom';
import { clearResolvedVoices } from '../voices';
import { clearAudioCache } from '../audio/cache';

export function openSettings(onSaved: () => void): void {
  const current = getSettings();

  const elevenInput = el('input', {
    type: 'password',
    class: 'input',
    value: current.elevenLabsKey,
    placeholder: 'ElevenLabs API key',
    autocomplete: 'off',
  });

  const providerSelect = el(
    'select',
    { class: 'input' },
    el('option', { value: 'openrouter' }, 'OpenRouter (BYOK)'),
    el('option', { value: 'anthropic' }, 'Anthropic (direct)'),
  );
  providerSelect.value = current.llmProvider;

  const llmInput = el('input', {
    type: 'password',
    class: 'input',
    value: current.llmKey,
    placeholder: 'LLM API key',
    autocomplete: 'off',
  });

  const modelInput = el('input', {
    type: 'text',
    class: 'input',
    value: current.llmModel,
    placeholder: 'Model id',
  });

  providerSelect.addEventListener('change', () => {
    const provider = providerSelect.value as LlmProvider;
    modelInput.value =
      provider === 'anthropic'
        ? config.llm.anthropic.defaultModel
        : config.llm.openrouter.defaultModel;
  });

  const rememberBox = el('input', { type: 'checkbox', checked: isRemembering() });
  const proxyBox = el('input', { type: 'checkbox', checked: current.useProxy });

  const overlay = el('div', { class: 'overlay' });
  const close = () => overlay.remove();

  const save = () => {
    setSettings(
      {
        elevenLabsKey: elevenInput.value.trim(),
        llmProvider: providerSelect.value as LlmProvider,
        llmKey: llmInput.value.trim(),
        llmModel: modelInput.value.trim(),
        jevKey: current.jevKey,
        useProxy: proxyBox.checked,
      },
      rememberBox.checked,
    );
    // A new key may be a different account, whose voice ids differ.
    clearResolvedVoices();
    close();
    onSaved();
  };

  const field = (label: string, control: HTMLElement, hint?: string) =>
    el(
      'label',
      { class: 'field' },
      el('span', { class: 'field-label' }, label),
      control,
      hint ? el('span', { class: 'hint' }, hint) : null,
    );

  overlay.append(
    el(
      'div',
      { class: 'modal' },
      el('h2', {}, 'Settings'),
      el(
        'p',
        { class: 'hint' },
        'Keys are held in memory for this page only. They are never written to disk, ' +
          'logs or the audio cache.',
      ),
      field('ElevenLabs key', elevenInput, 'Used for speech, transcription and alignment.'),
      field('Text LLM provider', providerSelect, 'Used for free-form replies and the correction report.'),
      field('LLM key', llmInput),
      field('Model', modelInput),
      el(
        'label',
        { class: 'checkbox' },
        rememberBox,
        el('span', {}, 'Remember for this tab (sessionStorage, cleared when the tab closes)'),
      ),
      el(
        'label',
        { class: 'checkbox' },
        proxyBox,
        el('span', {}, 'Route calls through the dev proxy (use if a call is blocked by CORS)'),
      ),
      el(
        'div',
        { class: 'row' },
        button('Save', save, 'btn primary'),
        button('Cancel', close),
        button('Clear audio cache', () => {
          void clearAudioCache().then(() => {
            clearResolvedVoices();
            window.location.reload();
          });
        }),
      ),
      el(
        'p',
        { class: 'hint' },
        'Clear the cache after changing a voice or the model, so lines are ' +
          'regenerated rather than replayed from the old recording.',
      ),
    ),
  );

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  elevenInput.focus();
}
