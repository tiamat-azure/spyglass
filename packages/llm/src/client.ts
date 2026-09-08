import type { RawEvent, RefinedStep } from '@spyglass/contracts';
import {
  ANTHROPIC_MESSAGES_PATH,
  ANTHROPIC_VERSION,
  DEFAULT_FAST_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  LLM_FAST_MODEL_DEFAULT,
  LLM_FAST_PROVIDER_DEFAULT,
  LLM_FAST_TIMEOUT_MS_DEFAULT,
  LLM_SMART_MAX_TOKENS_DEFAULT,
  LLM_SMART_MODEL_DEFAULT,
  LLM_SMART_PROVIDER_DEFAULT,
  LLM_SMART_TIMEOUT_MS_DEFAULT,
  pinSmartModel
} from './constants.ts';
import {
  assertNoLeak,
  type ExpurgatedEvent,
  expurgateBatch,
  secretLikeTokens,
  sensitiveQueryValues
} from './expurgate.ts';
import { buildNarrationMessages, type NarrationItem, parseNarrationResponse } from './narration.ts';
import {
  allowedRefineIds,
  bindLlmProposal,
  buildRefineMessages,
  type ExpurgatedRefineEvent,
  mockRefineProposals,
  parseRefineResponse,
  type RefineAggressiveness,
  refineFromRaw
} from './refine.ts';

export type LlmProfileName = 'fast' | 'smart';

export type ProfileConfig = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
};

export type TransportRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  profile: LlmProfileName;
};

export type TransportResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

export type LlmTransport = {
  complete: (request: TransportRequest) => Promise<TransportResult>;
};

export type NarrateResult =
  | {
      ok: true;
      narrations: NarrationItem[];
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
    }
  | { ok: false; error: string; latencyMs: number };

export type RefineTransportResult =
  | {
      ok: true;
      steps: RefinedStep[];
      source: 'smart' | 'fallback';
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
    }
  | { ok: false; error: string; latencyMs: number };

export type ConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  multimodal: boolean;
  error?: string;
};

export type LlmGatewayOptions = {
  transport?: LlmTransport | (() => LlmTransport);
  /** « Test connection » always uses a live fetch — never the mock narrate path. */
  liveTransport?: LlmTransport;
  profiles: () => { fast: ProfileConfig; smart: ProfileConfig };
};

/**
 * Provider-agnostic gateway. Expurgation is mandatory and runs before the
 * transport sees any payload — there is no public method that skips it.
 */
export class LlmGateway {
  private readonly transport: LlmTransport | (() => LlmTransport);
  private readonly liveTransport: LlmTransport;
  private readonly profiles: () => { fast: ProfileConfig; smart: ProfileConfig };

  constructor(options: LlmGatewayOptions) {
    this.transport = options.transport ?? fetchTransport();
    this.liveTransport = options.liveTransport ?? fetchTransport();
    this.profiles = options.profiles;
  }

  async narrate(events: readonly RawEvent[]): Promise<NarrateResult> {
    const started = Date.now();
    if (events.length === 0) {
      return { ok: true, narrations: [], inputTokens: 0, outputTokens: 0, latencyMs: 0 };
    }
    const clean = expurgateBatch(events);
    assertNoLeaksFromSource(events, clean);
    const forbidden = collectForbidden(events);
    assertNoLeak(clean, forbidden);
    const messages = buildNarrationMessages(clean);
    const profile = this.profiles().fast;
    const request = toTransportRequest('fast', profile, messages.system, messages.user);
    assertNoLeak(request.body, forbidden);
    try {
      const result = await this.resolveNarrateTransport().complete(request);
      assertNoLeak(result, forbidden);
      const parsed = parseNarrationResponse(
        result.text,
        events.map((event) => event.id)
      );
      if ('error' in parsed) {
        return { ok: false, error: parsed.error, latencyMs: Date.now() - started };
      }
      return {
        ok: true,
        narrations: parsed.narrations,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - started
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started
      };
    }
  }

  /**
   * Smart-profile refinement (F-41). Expurgation is mandatory. Invalid model
   * output is rejected as a whole (prompt contract §2) and replaced by the
   * local deterministic fallback — never a partial merge.
   */
  async refine(
    events: readonly RawEvent[],
    aggressiveness: RefineAggressiveness = 'balanced'
  ): Promise<RefineTransportResult> {
    const started = Date.now();
    const fallback = refineFromRaw(events, aggressiveness);
    const cleanIds = allowedRefineIds(events);
    const forbidden = collectForbidden(events);
    const messages = buildRefineMessages(events, aggressiveness);
    assertNoLeak(messages, forbidden);
    const profile = this.profiles().smart;
    const request = toTransportRequest('smart', profile, messages.system, messages.user, {
      maxTokens: LLM_SMART_MAX_TOKENS_DEFAULT
    });
    assertNoLeak(request.body, forbidden);
    try {
      const result = await this.resolveNarrateTransport().complete(request);
      assertNoLeak(result, forbidden);
      const parsed = parseRefineResponse(result.text, cleanIds);
      if ('error' in parsed) {
        return {
          ok: true,
          steps: fallback,
          source: 'fallback',
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: Date.now() - started
        };
      }
      const bound = bindLlmProposal(parsed.steps, events, aggressiveness);
      if ('error' in bound) {
        return {
          ok: true,
          steps: fallback,
          source: 'fallback',
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: Date.now() - started
        };
      }
      return {
        ok: true,
        steps: bound,
        source: 'smart',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - started
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started
      };
    }
  }

  async testConnection(profileName: LlmProfileName): Promise<ConnectionTestResult> {
    const started = Date.now();
    const profile = this.profiles()[profileName];
    if (profile.apiKey.trim().length === 0) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        multimodal: isMultimodal(profile.model),
        error: 'missing api key'
      };
    }
    const request = toTransportRequest(
      profileName,
      profile,
      'Reply with the single word pong.',
      'ping'
    );
    try {
      await this.liveTransport.complete(request);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        multimodal: isMultimodal(profile.model)
      };
    } catch (error) {
      const result: ConnectionTestResult = {
        ok: false,
        latencyMs: Date.now() - started,
        multimodal: isMultimodal(profile.model)
      };
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  private resolveNarrateTransport(): LlmTransport {
    return typeof this.transport === 'function' ? this.transport() : this.transport;
  }
}

export function isMultimodal(model: string): boolean {
  const lower = model.toLowerCase();
  return (
    lower.includes('sonnet') ||
    lower.includes('opus') ||
    lower.includes('gpt-4o') ||
    lower.includes('vision') ||
    lower.includes('gemini')
  );
}

export function resolveProfile(
  name: LlmProfileName,
  env: NodeJS.ProcessEnv = process.env
): Omit<ProfileConfig, 'apiKey'> & { apiKeyEnv: string | undefined } {
  const prefix = name === 'fast' ? 'LLM_FAST' : 'LLM_SMART';
  const providerDefault = name === 'fast' ? LLM_FAST_PROVIDER_DEFAULT : LLM_SMART_PROVIDER_DEFAULT;
  const modelDefault = name === 'fast' ? LLM_FAST_MODEL_DEFAULT : LLM_SMART_MODEL_DEFAULT;
  const provider = nonempty(env[`${prefix}_PROVIDER`]) ?? providerDefault;
  const modelRaw = nonempty(env[`${prefix}_MODEL`]) ?? modelDefault;
  const model = name === 'smart' ? pinSmartModel(modelRaw) : modelRaw;
  const baseUrl =
    nonempty(env[`${prefix}_BASE_URL`]) ??
    (provider === 'openai' ? DEFAULT_OPENAI_BASE_URL : DEFAULT_FAST_BASE_URL);
  const timeoutKey = name === 'fast' ? 'LLM_FAST_TIMEOUT_MS' : 'LLM_SMART_TIMEOUT_MS';
  const timeoutDefault =
    name === 'fast' ? LLM_FAST_TIMEOUT_MS_DEFAULT : LLM_SMART_TIMEOUT_MS_DEFAULT;
  const timeoutRaw = nonempty(env[timeoutKey]);
  const timeoutMs =
    timeoutRaw !== undefined && Number.parseInt(timeoutRaw, 10) > 0
      ? Number.parseInt(timeoutRaw, 10)
      : timeoutDefault;
  return {
    provider,
    model,
    baseUrl,
    timeoutMs,
    apiKeyEnv: nonempty(env[`${prefix}_API_KEY`])
  };
}

export function toTransportRequest(
  profile: LlmProfileName,
  config: ProfileConfig,
  system: string,
  user: string,
  options?: { maxTokens?: number }
): TransportRequest {
  const maxTokens =
    options?.maxTokens ?? (profile === 'smart' ? LLM_SMART_MAX_TOKENS_DEFAULT : 1024);
  const provider = config.provider.toLowerCase();
  if (provider === 'openai' || provider === 'openai-compatible') {
    const url = joinUrl(config.baseUrl, '/chat/completions');
    return {
      url,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json'
      },
      body: {
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0,
        max_tokens: maxTokens
      },
      timeoutMs: config.timeoutMs,
      profile
    };
  }
  const url = joinUrl(config.baseUrl, ANTHROPIC_MESSAGES_PATH);
  return {
    url,
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json'
    },
    body: {
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    },
    timeoutMs: config.timeoutMs,
    profile
  };
}

export function fetchTransport(): LlmTransport {
  return {
    complete: async (request) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, request.timeoutMs);
      try {
        const response = await fetch(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: controller.signal
        });
        const raw = await response.text();
        if (!response.ok) {
          throw new Error(truncateProviderError(raw, response.status));
        }
        return parseProviderBody(raw, request.headers['anthropic-version'] !== undefined);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export type MockTransportOptions = {
  delayMs?: number;
  fail?: boolean | string;
  tokensPerCall?: number;
  enrich?: (events: ExpurgatedEvent[]) => NarrationItem[];
};

export function createMockTransport(options: MockTransportOptions = {}): LlmTransport {
  const delayMs = options.delayMs ?? 40;
  const tokensPerCall = options.tokensPerCall ?? 80;
  return {
    complete: async (request) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (options.fail === true) {
        throw new Error('mock transport offline');
      }
      if (typeof options.fail === 'string') {
        throw new Error(options.fail);
      }
      const user = extractUserContent(request.body);
      let events: ExpurgatedEvent[] = [];
      let refineTask = false;
      let aggressiveness: RefineAggressiveness = 'balanced';
      try {
        const parsed = JSON.parse(user) as {
          task?: unknown;
          aggressiveness?: unknown;
          events?: ExpurgatedEvent[];
        };
        events = Array.isArray(parsed.events) ? parsed.events : [];
        refineTask = parsed.task === 'refine';
        if (
          parsed.aggressiveness === 'conservative' ||
          parsed.aggressiveness === 'balanced' ||
          parsed.aggressiveness === 'aggressive'
        ) {
          aggressiveness = parsed.aggressiveness;
        }
      } catch {
        events = [];
      }
      if (refineTask) {
        const steps = mockRefineProposals(events as ExpurgatedRefineEvent[], aggressiveness);
        return {
          text: JSON.stringify({ steps }),
          inputTokens: Math.max(1, tokensPerCall - 40),
          outputTokens: Math.max(20, tokensPerCall)
        };
      }
      const narrations =
        options.enrich?.(events) ??
        events.map((event) => ({
          id: event.id,
          text: mockEnrichment(event)
        }));
      return {
        text: JSON.stringify({ narrations }),
        inputTokens: Math.max(1, tokensPerCall - 20),
        outputTokens: 20
      };
    }
  };
}

export function mockEnrichment(event: ExpurgatedEvent): string {
  const name = event.target?.accessibleName ?? event.target?.text ?? event.target?.testId;
  const role = event.target?.role ?? event.target?.tag;
  if (event.kind === 'dom.click' && name !== undefined) {
    const article = role === 'button' || role === 'BUTTON' ? 'le bouton' : "l'élément";
    return `Tu as cliqué sur ${article} ${name}`;
  }
  if (event.kind === 'dom.input' && name !== undefined) {
    return `Tu as rempli le champ ${name}`;
  }
  if (name !== undefined) {
    return `Tu as interagi avec ${name}`;
  }
  return `Tu as effectué l'action ${event.kind}`;
}

function extractUserContent(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return '';
  }
  const record = body as { messages?: Array<{ role?: string; content?: unknown }> };
  const messages = record.messages;
  if (!Array.isArray(messages)) {
    return '';
  }
  const user = messages.find((row) => row.role === 'user');
  return typeof user?.content === 'string' ? user.content : '';
}

function parseProviderBody(raw: string, anthropic: boolean): TransportResult {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('empty provider body');
  }
  const record = parsed as Record<string, unknown>;
  if (anthropic) {
    const content = record.content;
    const text = Array.isArray(content)
      ? content
          .map((part) =>
            typeof part === 'object' &&
            part !== null &&
            (part as { type?: unknown }).type === 'text' &&
            typeof (part as { text?: unknown }).text === 'string'
              ? (part as { text: string }).text
              : ''
          )
          .join('')
      : '';
    const usage = record.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return {
      text,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0
    };
  }
  const choices = record.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message =
    typeof first === 'object' && first !== null
      ? (first as { message?: { content?: unknown } }).message
      : undefined;
  const text = typeof message?.content === 'string' ? message.content : '';
  const usage = record.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    text,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0
  };
}

/**
 * Tokens that must not appear uncleansed after expurgation: masked secret refs
 * (shouldMaskField), SECRET_LIKE hits, and sensitive query-param values.
 * Ordinary form input ("input", "test", "Email") is not forbidden against the
 * system prompt — those values are still dropped from the expurgated batch.
 */
function collectForbidden(events: readonly RawEvent[]): string[] {
  const tokens = new Set<string>();
  const add = (value: string | undefined): void => {
    const token = value?.trim();
    if (token !== undefined && token.length >= 4) {
      tokens.add(token);
    }
  };
  const addSecretLike = (value: string | undefined): void => {
    if (value === undefined || value.length === 0) {
      return;
    }
    for (const match of secretLikeTokens(value)) {
      add(match);
    }
  };

  for (const event of events) {
    if (event.value?.masked === true) {
      add(event.value.secretRef);
    } else if (event.value?.masked === false) {
      addSecretLike(event.value.text);
    }
    addSecretLike(event.page?.title);
    if (typeof event.page?.url === 'string') {
      addSecretLike(event.page.url);
      for (const value of sensitiveQueryValues(event.page.url)) {
        add(value);
      }
    }
    if (event.target !== undefined) {
      addSecretLike(event.target.accessibleName);
      addSecretLike(event.target.text);
      addSecretLike(event.target.name);
    }
  }
  return [...tokens];
}

function assertNoLeaksFromSource(
  source: readonly RawEvent[],
  clean: readonly ExpurgatedEvent[]
): void {
  const blob = JSON.stringify(clean);
  for (const event of source) {
    if (event.value?.masked === true && blob.includes(event.value.secretRef)) {
      throw new Error('expurgation leak');
    }
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path}`;
}

function nonempty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function truncateProviderError(raw: string, status: number): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  const slice = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
  return `HTTP ${String(status)} ${slice}`;
}
