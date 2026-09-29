import {
  JevError,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionResponse,
} from './types';
import { compactState } from './compact-state';

export interface OpenRouterOptions {
  apiKey?: string;
  model?: string;
  /** Injectable transport for tests. */
  fetch?: typeof globalThis.fetch;
}

export class OpenRouterProvider implements DecisionProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: OpenRouterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
    if (!this.apiKey)
      throw new JevError('CONFIG', 'Set OPENROUTER_API_KEY or pass apiKey.');
    this.model =
      options.model ??
      process.env.OPENROUTER_MODEL ??
      process.env.JEV_MODEL ??
      'typesafe/jev-1.13';
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async decide(
    request: DecisionRequest,
    signal: AbortSignal,
  ): Promise<DecisionResponse> {
    let response: Response;
    const packed = compactState(request.state);
    const questions = packed.compacted
      ? Object.fromEntries(
          Object.entries(request.questions).map(([id, question]) => [
            id,
            {
              ...question,
              instructions: `${question.instructions} Repeated text in state is represented as {"textRef":"tN"}; read its full text from sharedText[tN]. These references preserve the original evidence.`,
            },
          ]),
        )
      : request.questions;
    try {
      response = await this.fetch('https://openrouter.ai/api/alpha/decisions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state: packed.state,
          questions,
          model: this.model,
        }),
        signal,
      });
    } catch {
      throw new JevError(
        'PROVIDER',
        signal.aborted
          ? 'OpenRouter request timed out.'
          : 'OpenRouter request failed.',
        { retryable: true },
      );
    }
    // Do not echo provider response bodies: they may contain request data.
    if (!response.ok) {
      // Recognize a known error code without echoing arbitrary provider text or page data.
      let reason = '';
      try {
        const body = await response.text();
        if (body.includes('max_tokens_exceeded'))
          reason =
            ' Jev context limit exceeded; narrow the page scope with within().';
      } catch {
        /* Preserve the HTTP failure if reading its body also fails. */
      }
      throw new JevError(
        'PROVIDER',
        `OpenRouter returned HTTP ${response.status}.${reason}`,
        { retryable: [408, 429, 500, 502, 503, 504].includes(response.status) },
      );
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      if (signal.aborted)
        throw new JevError('PROVIDER', 'OpenRouter response body timed out.', {
          retryable: true,
        });
      throw new JevError(
        'INVALID_RESPONSE',
        'OpenRouter returned invalid JSON.',
      );
    }
    validateResponse(result, request);
    return result;
  }
}

export function validateResponse(
  value: unknown,
  request: DecisionRequest,
): asserts value is DecisionResponse {
  const result = value as DecisionResponse | null;
  const probability = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  const invalid = () => {
    throw new JevError(
      'INVALID_RESPONSE',
      'Malformed or incomplete Jev decision.',
    );
  };
  if (
    !result ||
    typeof result.model !== 'string' ||
    !result.answers ||
    typeof result.answers !== 'object'
  )
    return invalid();
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = result.answers[id];
    if (!answer || answer.type !== question.type) return invalid();
    if (answer.type === 'noul') {
      if (!probability(answer.noul)) return invalid();
    } else if (question.type === 'choice') {
      if (
        !Object.hasOwn(question.criteria, answer.choice) ||
        !probability(answer.confidence) ||
        !answer.probabilities
      )
        return invalid();
      const keys = Object.keys(question.criteria);
      if (
        Object.keys(answer.probabilities).length !== keys.length ||
        keys.some((key) => !probability(answer.probabilities[key]))
      )
        return invalid();
      const values = Object.values(answer.probabilities);
      if (
        Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.02 ||
        answer.probabilities[answer.choice]! < Math.max(...values)
      )
        return invalid();
    }
  }
}
