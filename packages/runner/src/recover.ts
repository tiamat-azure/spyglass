import type { RefinedStep, ReplayDescriptor, Scenario } from '@spyglass/contracts';
import {
  bestCorrelatedObservation,
  type LlmGateway,
  type ObserveCandidate,
  type RecoveryPatchProposal
} from '@spyglass/llm';
import type { PageSnapshot } from './driver.ts';

/** A5a: prefer R3c observe over the LLM patch at exact selector (100) or stable id/testid (80). */
export const OBSERVE_PREFER_MIN_SCORE = 80;

export type RecoveryContext = {
  scenario: Scenario;
  step: RefinedStep;
  attempt: number;
  error: string;
  beforeDom?: PageSnapshot;
  afterDom?: PageSnapshot;
  screenshotPath?: string;
  multimodal: boolean;
};

export type RecoveryAttempt = {
  descriptor: ReplayDescriptor;
  diagnosis: string;
  confidence: number;
  observeUsed: boolean;
};

export type Recoverer = {
  recover: (context: RecoveryContext) => Promise<RecoveryAttempt | undefined>;
};

export type ObserveFn = () => Promise<{ ok: boolean; observations: ObserveCandidate[] }>;

export class StaticRecoverer implements Recoverer {
  constructor(
    private readonly descriptor: ReplayDescriptor,
    private readonly diagnosis: string
  ) {}

  async recover(): Promise<RecoveryAttempt> {
    return {
      descriptor: this.descriptor,
      diagnosis: this.diagnosis,
      confidence: 1,
      observeUsed: false
    };
  }
}

export class LlmRecoverer implements Recoverer {
  constructor(
    private readonly gateway: LlmGateway,
    private readonly observe?: ObserveFn
  ) {}

  async recover(context: RecoveryContext): Promise<RecoveryAttempt | undefined> {
    const observed = await this.preferObserve(context);
    if (observed !== undefined) {
      return observed;
    }
    const proposal = await this.gateway.recover({
      scenario: context.scenario,
      step: context.step,
      error: context.error,
      attempt: context.attempt,
      beforeDom: context.beforeDom,
      afterDom: context.afterDom,
      // L5-ADV-02: text-DOM only — never claim a screenshot unless bytes are attached.
      screenshotIncluded: false
    });
    if (!proposal.ok) {
      return undefined;
    }
    return fromProposal(proposal.proposal);
  }

  private async preferObserve(context: RecoveryContext): Promise<RecoveryAttempt | undefined> {
    if (this.observe === undefined) {
      return undefined;
    }
    try {
      const result = await this.observe();
      if (!result.ok) {
        return undefined;
      }
      const match = bestCorrelatedObservation(context.step, result.observations);
      const selector = match?.observation.selector?.trim();
      if (
        match === undefined ||
        selector === undefined ||
        selector.length === 0 ||
        match.score < OBSERVE_PREFER_MIN_SCORE
      ) {
        return undefined;
      }
      return {
        descriptor: {
          ...context.step.action.descriptor,
          selector
        },
        diagnosis: 'observe() R3c-correlated selector (never array-index)',
        confidence: match.score / 100,
        observeUsed: true
      };
    } catch {
      return undefined;
    }
  }
}

function fromProposal(proposal: RecoveryPatchProposal): RecoveryAttempt {
  return {
    descriptor: proposal.patch.descriptor,
    diagnosis: proposal.diagnosis,
    confidence: proposal.confidence,
    observeUsed: false
  };
}
