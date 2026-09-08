import { access, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RefinedStep, Scenario } from '@spyglass/contracts';
import { repoRoot } from '@spyglass/contracts';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli.ts';
import {
  generatedReadme,
  generatedScenarioTsSource,
  generateFromSessionDir,
  loadFinalizedScenarioForGenerate,
  npmPackageNameForSession,
  readSessionStartUrl,
  writeGeneratedFromRevision,
  writeGeneratedPackage
} from './generate.ts';
import { runGenerateCli } from './generate-cli.ts';
import { runGeneratedScript } from './generated-run.ts';
import { parseGeneratedArgv, parseRunnerArgv } from './options.ts';
import { RUNNER_PACKAGE } from './package-name.ts';
import { screenshotFileName, traceFileName } from './paths.ts';
import { runScenario } from './run.ts';
import { asScenario, loadScenarioFile } from './scenario.ts';

function clickStep(): RefinedStep {
  return {
    index: 0,
    intent: 'Je clique sur Start',
    action: {
      type: 'click',
      descriptor: {
        type: 'click',
        selector: '[data-testid="go"]',
        selectorStrategy: 'testId'
      }
    },
    verification: {
      type: 'elementVisible',
      expected: '[data-testid="done"]',
      strength: 'strong',
      confirmedByUser: true
    },
    sourceEvents: ['evt_000001']
  };
}

function scenario(): Scenario {
  return {
    schemaVersion: 1,
    sessionId: 'ses_lot6_gen',
    startUrl: 'http://127.0.0.1:9/lot6-fixture.html',
    generatedAt: '2026-09-08T12:00:00.000Z',
    model: 'claude-sonnet-4-5-20250929',
    steps: [clickStep()]
  };
}

describe('Lot 6 generated package (ADR-0006 / F-45)', () => {
  it('writes scenario.json, scenario.ts, README.md, package.json with declared runner dep', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-gen-'));
    const paths = await writeGeneratedPackage({ sessionDir, scenario: scenario() });
    const json = JSON.parse(await readFile(paths.scenarioJson, 'utf8')) as Scenario;
    expect(json.sessionId).toBe('ses_lot6_gen');
    expect(json.steps).toHaveLength(1);
    const ts = await readFile(paths.scenarioTs, 'utf8');
    expect(ts).toContain("from '@spyglass/runner'");
    expect(ts).toContain('runScenario');
    expect(ts.startsWith('#!/usr/bin/env -S node --experimental-transform-types\n')).toBe(true);
    expect(ts).not.toMatch(/^#!\/usr\/bin\/env node$/m);
    expect(ts).toMatch(/import \{ runScenario \} from '@spyglass\/runner'/);
    expect(ts).not.toContain('runGeneratedScript');
    expect(ts).toContain('scenario.json');
    expect(ts.replaceAll('\\n', '')).not.toMatch(/[\\]/);
    const readme = await readFile(paths.readme, 'utf8');
    expect(readme).toMatch(/mode d'emploi|Script généré/i);
    expect(readme).toContain('--headless');
    expect(readme).toContain('--no-ai');
    expect(readme).toContain('--base-url');
    expect(readme).toMatch(/origine|origin|staging/i);
    expect(readme).toContain('WHATWG');
    expect(readme).toContain('--timeout');
    expect(readme).toContain('--max-ai-retries');
    expect(readme).toContain('--ai');
    expect(readme).toContain('--report');
    expect(readme).toMatch(/pas.*process\.cwd\(\)|A19a/i);
    expect(readme).toContain('--trace');
    expect(readme).toContain(RUNNER_PACKAGE);
    const manifest = JSON.parse(await readFile(paths.packageJson, 'utf8')) as {
      dependencies: Record<string, string>;
      type: string;
    };
    expect(manifest.type).toBe('module');
    expect(manifest.dependencies[RUNNER_PACKAGE]).toBe('0.0.0');
    expect(npmPackageNameForSession('ses_Lot 6!')).toBe('spyglass-scenario-ses-lot-6');
  });

  it('Lot 6 capture evidence HTML labels runScenario not runGeneratedScript (L6-015)', async () => {
    const capture = await readFile(join(repoRoot(), 'scripts/capture-lot-6.mjs'), 'utf8');
    expect(capture).toContain("import { runScenario } from '@spyglass/runner'");
    expect(capture).toContain('@spyglass/runner runScenario');
    expect(capture).not.toContain("import { runGeneratedScript } from '@spyglass/runner'");
    expect(capture).not.toContain('@spyglass/runner runGeneratedScript');
  });

  it('Lot 6 capture shows compact published rates, fullPage protocol shot, and unlinks HTML (L6-016 / L6-017)', async () => {
    const capture = await readFile(join(repoRoot(), 'scripts/capture-lot-6.mjs'), 'utf8');
    expect(capture).toContain('fullPage: true');
    expect(capture).toContain('compactRates');
    expect(capture).toContain('unlink(join(shotDir, name))');
    expect(capture).toContain('replayWithoutAiRate');
    const gitignore = await readFile(join(repoRoot(), '.gitignore'), 'utf8');
    expect(gitignore).toContain('docs/lot-6/screenshots/*.html');
  });

  it('Lot 6 evidence files named .png are actual PNGs (L6-018)', async () => {
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const names = [
      'generated-script-tree.png',
      'headed-run.png',
      'headless-run.png',
      'corpus-protocol-snippet.png'
    ];
    for (const name of names) {
      const buf = await readFile(join(repoRoot(), 'docs/lot-6/screenshots', name));
      expect(buf.subarray(0, 4).equals(pngMagic), `${name} must start with PNG magic`).toBe(true);
    }
    const capture = await readFile(join(repoRoot(), 'scripts/capture-lot-6.mjs'), 'utf8');
    expect(capture).toContain("join(shotDir, 'generated-script-tree.png')");
    expect(capture).toContain("join(shotDir, 'headed-run.png')");
    expect(capture).toContain("join(shotDir, 'headless-run.png')");
    expect(capture).toContain("join(shotDir, 'corpus-protocol-snippet.png')");
  });

  it('Lot 6 capture goto uses pathToFileURL not file:// plus join (L6-021)', async () => {
    const capture = await readFile(join(repoRoot(), 'scripts/capture-lot-6.mjs'), 'utf8');
    expect(capture).toContain("import { pathToFileURL } from 'node:url'");
    expect(capture).toContain("pathToFileURL(join(shotDir, 'tree.html')).href");
    expect(capture).toContain("pathToFileURL(join(shotDir, 'headless.html')).href");
    expect(capture).toContain("pathToFileURL(join(shotDir, 'protocol.html')).href");
    expect(capture).not.toMatch(/file:\/\/\$\{join/);
  });

  it('is visible by default and wires F-58 flags; CI does not force headless', () => {
    const headed = parseGeneratedArgv(['--no-ai', '--timeout', '5000'], { CI: '1' });
    expect(headed.headless).toBe(false);
    expect(headed.aiRecovery).toBe(false);
    expect(headed.timeoutMs).toBe(5000);
    const headless = parseGeneratedArgv(
      [
        '--headless',
        '--base-url',
        'https://app.test',
        '--max-ai-retries',
        '2',
        '--trace',
        '--report',
        'out'
      ],
      {}
    );
    expect(headless.headless).toBe(true);
    expect(headless.baseUrl).toBe('https://app.test');
    expect(headless.maxAiRetries).toBe(2);
    expect(headless.trace).toBe(true);
    expect(headless.reportDir).toBe('out');
    expect(parseRunnerArgv(['s.json'], { CI: '1' }).headless).toBe(true);
  });

  it('keeps Windows-safe artifact names in the generated README/help path', () => {
    expect(screenshotFileName(1, 'fail')).toBe('step-1-fail.jpg');
    expect(traceFileName()).toBe('trace.zip');
    expect(generatedScenarioTsSource()).toContain("join(here, 'scenario.json')");
    expect(generatedScenarioTsSource()).toContain(
      '#!/usr/bin/env -S node --experimental-transform-types'
    );
    expect(generatedReadme('ses_x')).toMatch(/Windows/);
    expect(generatedReadme('ses_x')).toContain('env -S node --experimental-transform-types');
  });

  it('runScenario without a driver prints F-58 help and needs no API keys', async () => {
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      const result = await runScenario(scenario(), {
        argv: ['--help'],
        env: { CI: '1' }
      });
      expect(result.exitCode).toBe(0);
      expect(chunks.join('')).toMatch(/--headless/);
      expect(chunks.join('')).toMatch(/--no-ai/);
      expect(chunks.join('')).toMatch(/dirname|scenario directory/i);
      expect(chunks.join('')).toMatch(/process\.cwd\(\)/);
    } finally {
      process.stdout.write = write;
    }
  });

  it('spyglass-generate prints usage without a session dir', async () => {
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      expect(await runGenerateCli(['--help'])).toBe(0);
      expect(chunks.join('')).toMatch(/spyglass-generate/);
    } finally {
      process.stdout.write = write;
    }
  });

  it('spyglass-generate exits 1 on stderr when no finalized revision (L6-010)', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-cli-fail-'));
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(sessionDir, 'refined'), { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeFile(
      join(sessionDir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_lot6_gen',
        revision: 1,
        createdAt: '2026-09-08T12:00:00.000Z',
        status: 'reviewing',
        steps: scenario().steps
      }),
      'utf8'
    );
    const chunks: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await runGenerateCli([sessionDir])).toBe(1);
      expect(chunks.join('')).toMatch(/no finalized revision to generate from/);
    } finally {
      process.stderr.write = write;
    }
  });

  it('generateFromSessionDir reads a finalized rev-N.json', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-session-'));
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(sessionDir, 'refined'), { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeFile(
      join(sessionDir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_lot6_gen',
        revision: 1,
        createdAt: '2026-09-08T12:00:00.000Z',
        status: 'finalized',
        steps: scenario().steps
      }),
      'utf8'
    );
    const paths = await generateFromSessionDir(sessionDir);
    const json = JSON.parse(await readFile(paths.scenarioJson, 'utf8')) as Scenario;
    expect(json.startUrl).toBe('https://exemple.test/start');
  });

  it('refuses leftover generated/ when no finalized rev exists (L6-004)', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-leftover-'));
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(sessionDir, 'refined'), { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeFile(
      join(sessionDir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_lot6_gen',
        revision: 1,
        createdAt: '2026-09-08T12:00:00.000Z',
        status: 'reviewing',
        steps: scenario().steps
      }),
      'utf8'
    );
    await writeGeneratedPackage({
      sessionDir,
      scenario: { ...scenario(), startUrl: 'https://leftover.test/stale' }
    });
    await expect(generateFromSessionDir(sessionDir)).rejects.toThrow(
      /no finalized revision to generate from/
    );
    await expect(loadFinalizedScenarioForGenerate(sessionDir)).rejects.toThrow(
      /no finalized revision to generate from/
    );
    const leftover = JSON.parse(
      await readFile(join(sessionDir, 'generated', 'scenario.json'), 'utf8')
    ) as Scenario;
    expect(leftover.startUrl).toBe('https://leftover.test/stale');
  });

  it('regenerates from a finalized rev, not leftover generated/ (L6-004)', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-regen-'));
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(sessionDir, 'refined'), { recursive: true });
    await writeFile(
      join(sessionDir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://exemple.test/start' }),
      'utf8'
    );
    await writeGeneratedPackage({
      sessionDir,
      scenario: { ...scenario(), startUrl: 'https://leftover.test/stale' }
    });
    await writeFile(
      join(sessionDir, 'refined', 'rev-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'ses_lot6_gen',
        revision: 1,
        createdAt: '2026-09-08T12:00:00.000Z',
        status: 'finalized',
        steps: scenario().steps
      }),
      'utf8'
    );
    const paths = await generateFromSessionDir(sessionDir);
    const json = JSON.parse(await readFile(paths.scenarioJson, 'utf8')) as Scenario;
    expect(json.startUrl).toBe('https://exemple.test/start');
    expect(json.startUrl).not.toBe('https://leftover.test/stale');
  });

  it('discards partial generated/ if writeGeneratedPackage fails mid-write (L6-005)', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-partial-'));
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(sessionDir, 'generated', 'package.json'), { recursive: true });
    await expect(writeGeneratedPackage({ sessionDir, scenario: scenario() })).rejects.toThrow();
    await expect(access(join(sessionDir, 'generated'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('generated scenario.ts shebang uses env -S transform-types (L6-023)', () => {
    const source = generatedScenarioTsSource();
    expect(source.startsWith('#!/usr/bin/env -S node --experimental-transform-types\n')).toBe(true);
    expect(source).not.toMatch(/^#!\/usr\/bin\/env node\n/u);
  });

  it('readSessionStartUrl fails closed without embedding exemple.test (L6-024)', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-nourl-'));
    await expect(readSessionStartUrl(sessionDir)).rejects.toThrow(/missing startUrl/);
    await expect(
      writeGeneratedFromRevision(sessionDir, {
        sessionId: 'ses_lot6_gen',
        steps: scenario().steps
      })
    ).rejects.toThrow(/missing startUrl/);
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(sessionDir, 'generated'), { recursive: true });
    await writeFile(join(sessionDir, 'meta.json'), '{', 'utf8');
    await expect(readSessionStartUrl(sessionDir)).rejects.toThrow();
    await writeFile(join(sessionDir, 'meta.json'), JSON.stringify({ startUrl: '' }), 'utf8');
    await expect(readSessionStartUrl(sessionDir)).rejects.toThrow(/missing startUrl/);
    await writeFile(
      join(sessionDir, 'meta.json'),
      JSON.stringify({ startUrl: 'https://captured.test/app' }),
      'utf8'
    );
    expect(await readSessionStartUrl(sessionDir)).toBe('https://captured.test/app');
    const paths = await writeGeneratedFromRevision(sessionDir, {
      sessionId: 'ses_lot6_gen',
      steps: scenario().steps
    });
    const json = JSON.parse(await readFile(paths.scenarioJson, 'utf8')) as Scenario;
    expect(json.startUrl).toBe('https://captured.test/app');
    expect(json.startUrl).not.toBe('https://exemple.test/start');
  });

  it('generated scenario.ts catches runScenario failures and exits 1 (L6-026)', () => {
    const source = generatedScenarioTsSource();
    expect(source).toContain('try {');
    expect(source).toContain('process.stderr.write');
    expect(source).toContain('process.exit(1)');
    expect(source).toContain("from '@spyglass/runner'");
    expect(source).not.toContain('runGeneratedScript');
  });

  it('writes scenario.ts executable on Unix (L6-027)', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-mode-'));
    const paths = await writeGeneratedPackage({ sessionDir, scenario: scenario() });
    if (process.platform === 'win32') {
      return;
    }
    expect((await stat(paths.scenarioTs)).mode & 0o111).toBeGreaterThan(0);
  });

  it('does not use --base-url as startUrl fallback (L6-028)', async () => {
    expect(() => asScenario({ sessionId: 'ses_x', steps: scenario().steps })).toThrow(
      /missing startUrl/
    );
    const sessionDir = await mkdtemp(join(tmpdir(), 'spyglass-lot6-nostart-'));
    const scenarioPath = join(sessionDir, 'scenario.json');
    await writeFile(
      scenarioPath,
      JSON.stringify({ schemaVersion: 1, sessionId: 'ses_x', steps: scenario().steps }),
      'utf8'
    );
    await expect(loadScenarioFile(scenarioPath)).rejects.toThrow(/missing startUrl/);
    const cliSrc = await readFile(join(repoRoot(), 'packages/runner/src/cli.ts'), 'utf8');
    expect(cliSrc).toContain('loadScenarioFile(scenarioPath)');
    expect(cliSrc).not.toContain('loadScenarioFile(scenarioPath, parsed.baseUrl)');
    const genSrc = await readFile(join(repoRoot(), 'packages/runner/src/generated-run.ts'), 'utf8');
    expect(genSrc).toContain('asScenario(scenarioInput)');
    expect(genSrc).not.toContain('asScenario(scenarioInput, parsed.baseUrl)');
    const chunks: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(
        await runGeneratedScript({ sessionId: 'ses_x', steps: scenario().steps }, ['--no-ai'])
      ).toBe(1);
      expect(await runCli([scenarioPath, '--base-url', 'https://staging.test/preview/'])).toBe(1);
      expect(chunks.join('')).toMatch(/missing startUrl/);
    } finally {
      process.stderr.write = write;
    }
  });
});
