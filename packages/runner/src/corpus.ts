import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { launchPlaywrightRun } from './launch.ts';
import { parseGeneratedArgv } from './options.ts';
import { runPath } from './paths.ts';
import { newRunId } from './run.ts';

export const LOCAL_CORPUS_SIZE = 10;

export type CorpusSite = {
  id: string;
  name: string;
  startUrl: string;
  text: string;
  urlGlob: string;
  /** When false, first step only checks that body is visible (JS-heavy homepages). */
  requireText?: boolean;
};

/**
 * Ten public sites for the non-contractual replay-rate protocol (PRD §2.2).
 * Stable standards / reserved-example hosts; no login, no ToS-hostile scraping.
 */
export const PUBLIC_CORPUS: readonly CorpusSite[] = [
  {
    id: 'example-com',
    name: 'example.com',
    startUrl: 'https://example.com/',
    text: 'Example Domain',
    urlGlob: 'https://example.com/'
  },
  {
    id: 'example-org',
    name: 'example.org',
    startUrl: 'https://example.org/',
    text: 'Example Domain',
    urlGlob: 'https://example.org/'
  },
  {
    id: 'example-net',
    name: 'example.net',
    startUrl: 'https://example.net/',
    text: 'Example Domain',
    urlGlob: 'https://example.net/'
  },
  {
    id: 'iana',
    name: 'iana.org',
    startUrl: 'https://www.iana.org/',
    text: 'IANA',
    urlGlob: 'https://www.iana.org/'
  },
  {
    id: 'w3c',
    name: 'w3.org',
    startUrl: 'https://www.w3.org/',
    text: 'W3C',
    urlGlob: 'https://www.w3.org/',
    requireText: false
  },
  {
    id: 'rfc-editor',
    name: 'rfc-editor.org',
    startUrl: 'https://www.rfc-editor.org/',
    text: 'RFC',
    urlGlob: 'https://www.rfc-editor.org/'
  },
  {
    id: 'ietf',
    name: 'ietf.org',
    startUrl: 'https://www.ietf.org/',
    text: 'IETF',
    urlGlob: 'https://www.ietf.org/'
  },
  {
    id: 'unicode',
    name: 'unicode.org',
    startUrl: 'https://home.unicode.org/',
    text: 'Unicode',
    urlGlob: 'https://home.unicode.org/'
  },
  {
    id: 'internic',
    name: 'internic.net',
    startUrl: 'https://www.internic.net/',
    text: 'InterNIC',
    urlGlob: 'https://www.internic.net/'
  },
  {
    id: 'cern-info',
    name: 'info.cern.ch',
    startUrl: 'https://info.cern.ch/',
    text: 'CERN',
    urlGlob: 'https://info.cern.ch/'
  }
];

export type CorpusWaveResult = {
  id: string;
  name: string;
  startUrl: string;
  ok: boolean;
  exitCode: number;
  mode: 'script' | 'AI' | 'none';
  error?: string;
  durationMs: number;
};

export type MeasuredRates = {
  schemaVersion: 1;
  protocol: 'prd-2.2-jplus1';
  measuredAt: string;
  wave: 'J+0' | 'J+1' | 'local-immutable';
  headless: boolean;
  aiRecovery: boolean;
  sites: CorpusWaveResult[];
  replayWithoutAiRate: number;
  replayWithAiRate: number | null;
  notes: string[];
};

export function waitStep(index: number, expectedText: string, requireText = true): RefinedStep {
  if (!requireText) {
    return {
      index,
      intent: 'Je vérifie que la page a chargé',
      action: {
        type: 'wait',
        descriptor: {
          type: 'wait',
          selector: 'body',
          selectorStrategy: 'css',
          description: 'Wait for document',
          arguments: ['8000']
        }
      },
      verification: {
        type: 'elementVisible',
        expected: 'body',
        strength: 'strong',
        confirmedByUser: true,
        timeoutMs: 12_000
      },
      sourceEvents: [`evt_${String(index + 1).padStart(6, '0')}`]
    };
  }
  return {
    index,
    intent: `Je vérifie que la page affiche « ${expectedText} »`,
    action: {
      type: 'wait',
      descriptor: {
        type: 'wait',
        selector: 'body',
        selectorStrategy: 'css',
        description: 'Wait for document',
        arguments: ['8000']
      }
    },
    verification: {
      type: 'textPresent',
      expected: expectedText,
      strength: 'strong',
      confirmedByUser: true,
      timeoutMs: 12_000
    },
    sourceEvents: [`evt_${String(index + 1).padStart(6, '0')}`]
  };
}

export function publicSiteScenario(site: CorpusSite, sessionId: string): Scenario {
  const wait = waitStep(0, site.text, site.requireText !== false);
  const urlCheck: RefinedStep = {
    index: 1,
    intent: `Je confirme l'URL de ${site.name}`,
    action: {
      type: 'wait',
      descriptor: {
        type: 'wait',
        selector: 'body',
        selectorStrategy: 'css',
        arguments: ['1000']
      }
    },
    verification: {
      type: 'urlMatches',
      expected: site.urlGlob,
      strength: 'strong',
      confirmedByUser: true,
      timeoutMs: 8_000
    },
    sourceEvents: ['evt_000002']
  };
  return {
    schemaVersion: 1,
    sessionId,
    startUrl: site.startUrl,
    generatedAt: new Date().toISOString(),
    steps: [wait, urlCheck]
  };
}

export function localCorpusSites(origin: string): CorpusSite[] {
  const sites: CorpusSite[] = [];
  for (let index = 1; index <= LOCAL_CORPUS_SIZE; index += 1) {
    const id = String(index).padStart(2, '0');
    sites.push({
      id: `local-${id}`,
      name: `corpus-site-${id}`,
      startUrl: `${origin}/site-${id}`,
      text: `Corpus site ${id}`,
      urlGlob: `${origin}/site-${id}`
    });
  }
  return sites;
}

export async function measureCorpus(input: {
  sites: readonly CorpusSite[];
  wave: MeasuredRates['wave'];
  reportRoot: string;
  env?: NodeJS.ProcessEnv;
  headless?: boolean;
  timeoutMs?: number;
}): Promise<MeasuredRates> {
  const env = input.env ?? process.env;
  const headless = input.headless !== false;
  const argv = ['--no-ai', '--timeout', String(input.timeoutMs ?? 15_000)];
  if (headless) {
    argv.unshift('--headless');
  }
  const parsed = parseGeneratedArgv(argv, { ...env, CI: env.CI ?? '1' });
  parsed.aiRecovery = false;
  parsed.headless = headless;
  const results: CorpusWaveResult[] = [];
  const started = new Date();
  for (const site of input.sites) {
    const siteStarted = Date.now();
    const runId = newRunId();
    const reportDir = runPath(input.reportRoot, site.id, runId);
    try {
      const result = await launchPlaywrightRun({
        scenario: publicSiteScenario(site, `ses_corpus_${site.id}`),
        parsed,
        env: { ...env, CI: '1' },
        reportDir,
        runId
      });
      const failed = result.report.steps.find((step) => step.status === 'failed');
      const row: CorpusWaveResult = {
        id: site.id,
        name: site.name,
        startUrl: site.startUrl,
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        mode: result.report.steps[0]?.mode ?? 'none',
        durationMs: Date.now() - siteStarted
      };
      if (failed?.error !== undefined) {
        row.error = failed.error;
      }
      results.push(row);
    } catch (error) {
      results.push({
        id: site.id,
        name: site.name,
        startUrl: site.startUrl,
        ok: false,
        exitCode: 1,
        mode: 'none',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - siteStarted
      });
    }
  }
  const passed = results.filter((row) => row.ok).length;
  const rate = results.length === 0 ? 0 : passed / results.length;
  return {
    schemaVersion: 1,
    protocol: 'prd-2.2-jplus1',
    measuredAt: started.toISOString(),
    wave: input.wave,
    headless,
    aiRecovery: false,
    sites: results,
    replayWithoutAiRate: rate,
    replayWithAiRate: null,
    notes: [
      'PRD §2.2 targets (>95% without AI on unchanged sites at J+1, >80% with AI on modified sites) are aspirational, not contractual.',
      'This wave used --no-ai (no API keys). Modified-site AI recovery is measured on the local fixture, not on public hosts.'
    ]
  };
}
