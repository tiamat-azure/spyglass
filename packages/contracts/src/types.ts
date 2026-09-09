export type RawEventKind =
  | 'dom.click'
  | 'dom.dblclick'
  | 'dom.input'
  | 'dom.change'
  | 'dom.check'
  | 'dom.select'
  | 'dom.submit'
  | 'dom.key'
  | 'dom.scroll'
  | 'nav.load'
  | 'nav.spa'
  | 'nav.redirect'
  | 'nav.back'
  | 'nav.forward'
  | 'nav.popup-redirected'
  | 'net.request'
  | 'selection.text'
  | 'selection.value'
  | 'voice.partial'
  | 'voice.final'
  | 'voice.edited'
  | 'agent.message'
  | 'agent.narration-mode'
  | 'user.message'
  | 'record.start'
  | 'record.pause'
  | 'record.resume'
  | 'record.stop'
  | 'step.retracted';

export type CapturedValue = { masked: false; text: string } | { masked: true; secretRef: string };

export type ReplayDescriptor = {
  type: 'click' | 'fill' | 'select' | 'check' | 'press' | 'navigate' | 'wait' | 'scroll';
  selector: string;
  selectorStrategy?: 'testId' | 'role+name' | 'id' | 'text' | 'css' | 'xpath';
  description?: string;
  fallbackSelectors?: string[];
  arguments?: string[];
  framePath?: string[];
  shadowPath?: string[];
};

export type BoundingBox = {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

export type ElementDescriptor = {
  tag: string;
  framePath: string[];
  shadowPath: string[];
  id?: string;
  testId?: string;
  testAttributes?: Record<string, string>;
  role?: string;
  accessibleName?: string;
  text?: string;
  name?: string;
  cssSelector?: string;
  xpath?: string;
  siblingIndex?: number;
  ancestors?: string[];
  boundingBox?: BoundingBox;
};

export type VoiceRelation = 'before' | 'after' | 'unanchored';

export type VoiceCapture = {
  text?: string;
  startTs?: number;
  endTs?: number;
  editedFrom?: string;
  audioRef?: string | null;
  relation?: VoiceRelation;
  correlatedEventId?: string;
  correlatedStepIndex?: number;
};

export type RawEvent = {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  ts: number;
  kind: RawEventKind;
  stepIndex?: number;
  pageId?: string;
  page?: { url?: string; title?: string };
  target?: ElementDescriptor;
  value?: CapturedValue;
  action?: ReplayDescriptor;
  narration?: { mode: 'template' | 'llm'; batchId?: string; text?: string };
  voice?: VoiceCapture;
  retracts?: string;
  snapshotRef?: string;
  screenshotRef?: string;
};

export type RefinedStep = {
  index: number;
  intent: string;
  action: {
    type: ReplayDescriptor['type'];
    descriptor: ReplayDescriptor;
    fallbackSelectors?: string[];
    parameterRef?: string;
  };
  verification: {
    type: 'urlMatches' | 'elementVisible' | 'elementAbsent' | 'textPresent' | 'valueEquals';
    expected: string;
    strength: 'strong' | 'weak';
    weakReason?:
      | 'observable-state-change'
      | 'no-observable-change'
      | 'ambiguous-target'
      | 'value-assertion';
    confirmedByUser: boolean;
    timeoutMs?: number;
  };
  sourceEvents: string[];
  patchHistory?: Array<{
    runId: string;
    date: string;
    scope: 'action.descriptor';
    reviewedBy: string;
    pullRequest: string;
  }>;
};

export type ScenarioHealth = {
  schemaVersion: 1;
  sessionId: string;
  status: 'healthy' | 'fragile' | 'stale';
  appliedPatches: number;
  patchCandidates: Array<{
    stepIndex: number;
    descriptorHash: string;
    consecutiveRuns: number;
    lastRunId: string;
  }>;
};

/** Executable scenario (PRD §6.12). Source of truth for `@spyglass/runner`. */
export type Scenario = {
  schemaVersion: 1;
  sessionId: string;
  startUrl: string;
  generatedAt?: string;
  model?: string;
  steps: RefinedStep[];
};

export type ExecutionStepMode = 'script' | 'AI';

export type ExecutionStepStatus = 'passed' | 'failed' | 'skipped';

export type ExecutionStepReport = {
  index: number;
  intent: string;
  status: ExecutionStepStatus;
  durationMs: number;
  mode: ExecutionStepMode;
  attempts: number;
  verificationOk: boolean;
  error?: string;
  screenshotRef?: string;
};

export type ExecutionReport = {
  schemaVersion: 1;
  runId: string;
  sessionId: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  headless: boolean;
  aiRecovery: boolean;
  maxAiRetries: number;
  smartModel: string;
  multimodal: boolean;
  warnings: string[];
  steps: ExecutionStepReport[];
};

export type SuggestedPatchEntry = {
  stepIndex: number;
  scope: 'action.descriptor';
  original: ReplayDescriptor;
  suggested: ReplayDescriptor;
  diagnosis: string;
  confidence: number;
};

/** F-57 / ADR-0008: written on successful recovery, never auto-applied. Lot 7 assisted apply is a git PR, not this flag. */
export type SuggestedPatch = {
  schemaVersion: 1;
  runId: string;
  sessionId: string;
  applied: false;
  patches: SuggestedPatchEntry[];
};
