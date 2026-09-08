import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  LLM_FAST_MODEL_DEFAULT,
  LLM_FAST_PROVIDER_DEFAULT,
  LLM_SMART_MODEL_DEFAULT,
  LLM_SMART_PROVIDER_DEFAULT,
  type LlmProfileName,
  type ProfileConfig,
  pinSmartModel,
  RATE_LIMIT_CALLS_PER_MIN_DEFAULT,
  resolveProfile,
  SESSION_TOKEN_LIMIT_FAST_DEFAULT,
  SMART_TOKEN_CONFIRM_DEFAULT,
  TOKEN_WARN_RATIO_DEFAULT
} from '@spyglass/llm';
import type {
  ConfigGetResponse,
  ConfigSetRequest,
  ConfigSource,
  MaskedProfileConfig
} from '../shared/ipc.ts';

export type SecretVault = {
  isAvailable: () => boolean;
  encrypt: (plain: string) => string;
  decrypt: (cipher: string) => string;
};

type StoredProfile = {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKeyCipher?: string;
};

type StoredSettings = {
  schemaVersion: 1;
  enrichmentEnabled?: boolean;
  sessionTokenLimitFast?: number;
  tokenWarnRatio?: number;
  rateLimitCallsPerMin?: number;
  smartTokenConfirm?: number;
  fast?: StoredProfile;
  smart?: StoredProfile;
};

const MASK = '••••••••••••';

export class SettingsStore {
  private memoryKeys: { fast?: string; smart?: string } = {};
  private disk: StoredSettings = { schemaVersion: 1 };

  constructor(
    private readonly path: string,
    private readonly vault: SecretVault,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        this.disk = { schemaVersion: 1, ...(parsed as Omit<StoredSettings, 'schemaVersion'>) };
      }
    } catch {
      this.disk = { schemaVersion: 1 };
    }
    assertNoPlaintextKey(this.disk);
  }

  encryptionAvailable(): boolean {
    return this.vault.isAvailable();
  }

  masked(): ConfigGetResponse {
    return {
      enrichmentEnabled: this.enrichmentEnabled(),
      sessionTokenLimitFast: this.sessionTokenLimitFast(),
      tokenWarnRatio: this.tokenWarnRatio(),
      rateLimitCallsPerMin: this.rateLimitCallsPerMin(),
      smartTokenConfirm: this.smartTokenConfirm(),
      encryptionAvailable: this.encryptionAvailable(),
      fast: this.maskedProfile('fast'),
      smart: this.maskedProfile('smart')
    };
  }

  profileConfig(name: LlmProfileName): ProfileConfig {
    const resolved = resolveProfile(name, this.env);
    const stored = name === 'fast' ? this.disk.fast : this.disk.smart;
    return {
      provider: nonempty(stored?.provider) ?? resolved.provider,
      model: nonempty(stored?.model) ?? resolved.model,
      baseUrl: nonempty(stored?.baseUrl) ?? resolved.baseUrl,
      apiKey: this.apiKey(name),
      timeoutMs: resolved.timeoutMs
    };
  }

  enrichmentEnabled(): boolean {
    if (this.disk.enrichmentEnabled !== undefined) {
      return this.disk.enrichmentEnabled;
    }
    if (this.env.SPYGLASS_LLM_OFFLINE === '1') {
      return false;
    }
    return true;
  }

  sessionTokenLimitFast(): number {
    return intOr(
      this.disk.sessionTokenLimitFast,
      intOr(
        Number.parseInt(this.env.SESSION_TOKEN_LIMIT_FAST ?? '', 10),
        SESSION_TOKEN_LIMIT_FAST_DEFAULT
      )
    );
  }

  tokenWarnRatio(): number {
    return numOr(
      this.disk.tokenWarnRatio,
      numOr(Number.parseFloat(this.env.TOKEN_WARN_RATIO ?? ''), TOKEN_WARN_RATIO_DEFAULT)
    );
  }

  rateLimitCallsPerMin(): number {
    return intOr(
      this.disk.rateLimitCallsPerMin,
      intOr(
        Number.parseInt(this.env.RATE_LIMIT_CALLS_PER_MIN ?? '', 10),
        RATE_LIMIT_CALLS_PER_MIN_DEFAULT
      )
    );
  }

  smartTokenConfirm(): number {
    return intOr(
      this.disk.smartTokenConfirm,
      intOr(Number.parseInt(this.env.SMART_TOKEN_CONFIRM ?? '', 10), SMART_TOKEN_CONFIRM_DEFAULT)
    );
  }

  async apply(
    patch: ConfigSetRequest
  ): Promise<{ ok: boolean; persistedKey: boolean; error?: string }> {
    if (patch.enrichmentEnabled !== undefined) {
      this.disk.enrichmentEnabled = patch.enrichmentEnabled;
    }
    if (patch.sessionTokenLimitFast !== undefined) {
      this.disk.sessionTokenLimitFast = Math.floor(patch.sessionTokenLimitFast);
    }
    if (patch.tokenWarnRatio !== undefined) {
      this.disk.tokenWarnRatio = patch.tokenWarnRatio;
    }
    if (patch.rateLimitCallsPerMin !== undefined) {
      this.disk.rateLimitCallsPerMin = Math.floor(patch.rateLimitCallsPerMin);
    }
    if (patch.smartTokenConfirm !== undefined) {
      this.disk.smartTokenConfirm = Math.floor(patch.smartTokenConfirm);
    }
    let persistedKey = true;
    if (patch.profile !== undefined) {
      const current = { ...(patch.profile === 'fast' ? this.disk.fast : this.disk.smart) };
      if (patch.provider !== undefined) {
        current.provider = patch.provider;
      }
      if (patch.model !== undefined) {
        current.model = patch.model;
      }
      if (patch.baseUrl !== undefined) {
        current.baseUrl = patch.baseUrl;
      }
      if (patch.apiKey !== undefined && patch.apiKey.length > 0 && patch.apiKey !== MASK) {
        this.memoryKeys[patch.profile] = patch.apiKey;
        if (!this.vault.isAvailable()) {
          persistedKey = false;
          delete current.apiKeyCipher;
        } else {
          current.apiKeyCipher = this.vault.encrypt(patch.apiKey);
        }
      }
      if (patch.profile === 'fast') {
        this.disk.fast = current;
      } else {
        this.disk.smart = current;
      }
    }
    await this.persist();
    const result: { ok: boolean; persistedKey: boolean; error?: string } = {
      ok: true,
      persistedKey
    };
    if (!persistedKey) {
      result.error = 'safeStorage unavailable — API key kept in memory only';
    }
    return result;
  }

  private apiKey(name: LlmProfileName): string {
    const memory = this.memoryKeys[name];
    if (memory !== undefined && memory.length > 0) {
      return memory;
    }
    const stored = name === 'fast' ? this.disk.fast : this.disk.smart;
    const cipher = stored?.apiKeyCipher;
    if (cipher !== undefined && cipher.length > 0 && this.vault.isAvailable()) {
      try {
        return this.vault.decrypt(cipher);
      } catch {
        // fall through to env
      }
    }
    return resolveProfile(name, this.env).apiKeyEnv ?? '';
  }

  private maskedProfile(name: LlmProfileName): MaskedProfileConfig {
    const resolved = resolveProfile(name, this.env);
    const stored = name === 'fast' ? this.disk.fast : this.disk.smart;
    const provider = nonempty(stored?.provider) ?? resolved.provider;
    const modelRaw = nonempty(stored?.model) ?? resolved.model;
    const model = name === 'smart' ? pinSmartModel(modelRaw) : modelRaw;
    const baseUrl = nonempty(stored?.baseUrl) ?? resolved.baseUrl;
    const key = this.apiKey(name);
    return {
      provider,
      model,
      baseUrl,
      hasApiKey: key.length > 0,
      apiKeyMasked: key.length > 0 ? MASK : '',
      sources: {
        provider: sourceOf(
          stored?.provider,
          this.env[name === 'fast' ? 'LLM_FAST_PROVIDER' : 'LLM_SMART_PROVIDER']
        ),
        model: sourceOf(
          stored?.model,
          this.env[name === 'fast' ? 'LLM_FAST_MODEL' : 'LLM_SMART_MODEL']
        ),
        baseUrl: sourceOf(
          stored?.baseUrl,
          this.env[name === 'fast' ? 'LLM_FAST_BASE_URL' : 'LLM_SMART_BASE_URL']
        ),
        apiKey: this.apiKeySource(name)
      }
    };
  }

  private apiKeySource(name: LlmProfileName): ConfigSource {
    if (
      this.memoryKeys[name] !== undefined ||
      nonempty(name === 'fast' ? this.disk.fast?.apiKeyCipher : this.disk.smart?.apiKeyCipher) !==
        undefined
    ) {
      return this.memoryKeys[name] !== undefined &&
        (name === 'fast' ? this.disk.fast?.apiKeyCipher : this.disk.smart?.apiKeyCipher) ===
          undefined
        ? 'ui'
        : 'ui';
    }
    if (nonempty(resolveProfile(name, this.env).apiKeyEnv) !== undefined) {
      return 'env';
    }
    return 'default';
  }

  private async persist(): Promise<void> {
    assertNoPlaintextKey(this.disk);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(this.disk, null, 2)}\n`, 'utf8');
  }
}

export function xorTestVault(): SecretVault {
  return {
    isAvailable: () => true,
    encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
    decrypt: (cipher) => Buffer.from(cipher, 'base64').toString('utf8')
  };
}

export function unavailableVault(): SecretVault {
  return {
    isAvailable: () => false,
    encrypt: () => {
      throw new Error('safeStorage unavailable');
    },
    decrypt: () => {
      throw new Error('safeStorage unavailable');
    }
  };
}

export function electronSafeStorageVault(safeStorage: {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (payload: Buffer) => string;
}): SecretVault {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  };
}

function sourceOf(ui: string | undefined, env: string | undefined): ConfigSource {
  if (nonempty(ui) !== undefined) {
    return 'ui';
  }
  if (nonempty(env) !== undefined) {
    return 'env';
  }
  return 'default';
}

function nonempty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function intOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function numOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function assertNoPlaintextKey(disk: StoredSettings): void {
  const blob = JSON.stringify(disk);
  if (/sk-[A-Za-z0-9_-]{8,}/.test(blob) || blob.includes('apiKey":')) {
    throw new Error('settings.json must never contain a plaintext API key');
  }
}

export const DEFAULT_MODELS = {
  fast: LLM_FAST_MODEL_DEFAULT,
  smart: LLM_SMART_MODEL_DEFAULT,
  fastProvider: LLM_FAST_PROVIDER_DEFAULT,
  smartProvider: LLM_SMART_PROVIDER_DEFAULT
} as const;

export function emptyConfig(): ConfigGetResponse {
  const blankSources = {
    provider: 'default' as const,
    model: 'default' as const,
    baseUrl: 'default' as const,
    apiKey: 'default' as const
  };
  return {
    enrichmentEnabled: true,
    sessionTokenLimitFast: SESSION_TOKEN_LIMIT_FAST_DEFAULT,
    tokenWarnRatio: TOKEN_WARN_RATIO_DEFAULT,
    rateLimitCallsPerMin: RATE_LIMIT_CALLS_PER_MIN_DEFAULT,
    smartTokenConfirm: SMART_TOKEN_CONFIRM_DEFAULT,
    encryptionAvailable: false,
    fast: {
      provider: LLM_FAST_PROVIDER_DEFAULT,
      model: LLM_FAST_MODEL_DEFAULT,
      baseUrl: '',
      hasApiKey: false,
      apiKeyMasked: '',
      sources: blankSources
    },
    smart: {
      provider: LLM_SMART_PROVIDER_DEFAULT,
      model: LLM_SMART_MODEL_DEFAULT,
      baseUrl: '',
      hasApiKey: false,
      apiKeyMasked: '',
      sources: blankSources
    }
  };
}
