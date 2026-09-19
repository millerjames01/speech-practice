/**
 * Text LLM adapter. ElevenLabs covers voice in both directions but does not
 * judge grammar, so free form needs a text model for the counterpart's replies
 * and for the end-of-session correction report.
 *
 * Two backends behind one interface: OpenRouter (BYOK, OpenAI-compatible) and
 * direct Anthropic. The provider is a setting, so switching costs nothing.
 */

import { config } from '../config';
import { getSettings, requireLlmKey } from '../keys';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Ask for JSON back. The report path parses the reply. */
  json?: boolean;
}

interface LlmBackend {
  chat(req: ChatRequest): Promise<string>;
}

async function postJson(url: string, headers: HeadersInit, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LLM request failed (${res.status}). ${detail.slice(0, 300)}`);
  }
  return res.json();
}

const openRouterBackend: LlmBackend = {
  async chat({ system, messages, maxTokens = 1024, json }) {
    const { useProxy, llmModel } = getSettings();
    const base = useProxy
      ? config.llm.openrouter.proxyUrl
      : config.llm.openrouter.baseUrl;

    const data = (await postJson(
      `${base}/api/v1/chat/completions`,
      {
        Authorization: `Bearer ${requireLlmKey()}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Conversation Trainer',
      },
      {
        model: llmModel || config.llm.openrouter.defaultModel,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      },
    )) as { choices?: { message?: { content?: string } }[] };

    return data.choices?.[0]?.message?.content ?? '';
  },
};

const anthropicBackend: LlmBackend = {
  async chat({ system, messages, maxTokens = 1024 }) {
    const { useProxy, llmModel } = getSettings();
    const base = useProxy ? config.llm.anthropic.proxyUrl : config.llm.anthropic.baseUrl;

    const data = (await postJson(
      `${base}/v1/messages`,
      {
        'x-api-key': requireLlmKey(),
        'anthropic-version': config.llm.anthropic.version,
        // Required for calls made straight from a browser.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      {
        model: llmModel || config.llm.anthropic.defaultModel,
        max_tokens: maxTokens,
        system,
        messages,
      },
    )) as { content?: { type: string; text?: string }[] };

    return (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
  },
};

export async function chat(req: ChatRequest): Promise<string> {
  const backend =
    getSettings().llmProvider === 'anthropic' ? anthropicBackend : openRouterBackend;
  return backend.chat(req);
}

/**
 * Models wrap JSON in prose or fences often enough that a bare JSON.parse is a
 * routine source of failure. Extract the outermost object first.
 */
export function parseJsonReply<T>(reply: string): T {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? reply).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`LLM reply contained no JSON object: ${reply.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
