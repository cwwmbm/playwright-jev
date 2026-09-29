export type CandidateKind =
  'click' | 'fill' | 'check' | 'container' | 'text' | 'form' | 'select';

export interface Candidate {
  id: string;
  tag: string;
  role: string;
  name: string;
  text: string;
  context: string;
  ancestors?: { tag: string; text: string }[];
  options?: {
    index: number;
    label: string;
    value: string;
    disabled: boolean;
  }[];
  multiple?: boolean;
  attributes: Record<string, string>;
  structure?: {
    directHeadings?: string[];
    descendantHeadings?: string[];
    childTags: string[];
    similarSiblings: number;
    images: string[];
  };
}

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'noul'; instructions: string; criteria?: Record<string, string> };

export interface DecisionRequest {
  state: unknown;
  questions: Record<string, Question>;
}

export interface DecisionResponse {
  model: string;
  answers: Record<string, ChoiceAnswer | NoulAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
}

export interface DecisionProvider {
  decide(
    request: DecisionRequest,
    signal: AbortSignal,
  ): Promise<DecisionResponse>;
}

export interface DecisionEvent {
  intent: string;
  kind: CandidateKind | 'verify';
  facts?: Record<string, string | number | boolean | null>;
  candidateCount: number;
  /** Redacted metadata exactly as sent to the provider. */
  candidates: Candidate[];
  elapsedMs: number;
  response: DecisionResponse;
}

export type ErrorCode =
  | 'CONFIG'
  | 'NO_MATCH'
  | 'AMBIGUOUS'
  | 'TOO_MANY_CANDIDATES'
  | 'STALE_TARGET'
  | 'PROVIDER'
  | 'INVALID_RESPONSE'
  | 'VERIFICATION_FAILED'
  | 'FORM_FILL_FAILED';

export class JevError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'JevError';
  }
}
