import type { RefinedStep, ReplayDescriptor, Scenario } from '@spyglass/contracts';
import {
  bestCorrelatedObservation,
  type LlmGateway,
  type ObserveCandidate,
  type RecoveryPatchProposal
} from '@spyglass/llm';
import type { PageSnapshot } from './driver.ts';

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
    let observeUsed = false;
    let observed: RecoveryAttempt | undefined;
    if (this.observe !== undefined) {
      try {
        const result = await this.observe();
        if (result.ok) {
          observeUsed = true;
          const match = bestCorrelatedObservation(context.step, result.observations);
          const selector = match?.observation.selector?.trim();
          if (selector !== undefined && selector.length > 0 && match !== undefined) {
            observed = {
              descriptor: {
                ...context.step.action.descriptor,
                selector
              },
              diagnosis: 'observe() R3c-correlated selector (never array-index)',
              confidence: match.score / 100,
              observeUsed: true
            };
          }
        }
      } catch {
        observeUsed = false;
      }
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
      return observed;
    }
    return fromProposal(proposal.proposal, observeUsed);
  }
}

function fromProposal(proposal: RecoveryPatchProposal, observeUsed: boolean): RecoveryAttempt {
  return {
    descriptor: proposal.patch.descriptor,
    diagnosis: proposal.diagnosis,
    confidence: proposal.confidence,
    observeUsed
  };
}
