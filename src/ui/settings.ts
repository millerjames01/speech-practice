/**
 * Settings modal. Asks for keys on load; nothing is stored unless "remember for
 * this tab" is ticked, and that only reaches sessionStorage.
 */

import { config } from '../config';
import { getSettings, isRemembering, setSettings, type LlmProvider } from '../keys';
import { button, el } from './dom';
import { versionLabel } from '../version';

/**
 * `extra` adds a section of settings that save themselves (the speedrun's
 * practice switches); with it, closing the dialog any way also runs onSaved,
 * so the page behind reflects them.
 */
export function openSettings(onSaved: () => void, extra?: HTMLElement): void {
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
  const close = () => {
    overlay.remove();
    if (extra) onSaved();
  };

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
    overlay.remove();
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
      extra ?? null,
      extra ? el('h3', {}, 'Keys') : null,
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
      el('div', { class: 'row' }, button('Save', save, 'btn primary'), button('Cancel', close)),
      el('p', { class: 'hint settings-version' }, versionLabel()),
    ),
  );

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  elevenInput.focus();
}
