import { test, expect } from '@playwright/test';
import { compactState } from '../src/compact-state';
import { OpenRouterProvider } from '../src';

test('factors repeated context without dropping candidates or changing evidence', () => {
  const context = 'Product context with names and prices. '.repeat(40);
  const state = {
    candidates: Array.from({ length: 116 }, (_, i) => ({
      id: `e${i}`,
      name: `Button ${i}`,
      context,
      ancestors: [{ text: context }],
    })),
  };
  const before = JSON.stringify(state);
  const result = compactState(state);
  expect(result.compacted).toBe(true);
  const packed = result.state as {
    candidates: unknown[];
    sharedText: Record<string, string>;
  };
  function expand(v: any): any {
    if (v && typeof v === 'object' && 'textRef' in v)
      return packed.sharedText[v.textRef];
    if (Array.isArray(v)) return v.map(expand);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v).map(([k, value]) => [k, expand(value)]),
      );
    return v;
  }
  expect(expand(packed.candidates)).toEqual(state.candidates);
  expect(JSON.stringify(result.state).length).toBeLessThan(before.length / 5);
  expect(JSON.stringify(state)).toBe(before);
});

test('context-limit errors explain scope without echoing provider data', async () => {
  const client = new OpenRouterProvider({
    apiKey: 'fake',
    fetch: async () =>
      Response.json(
        { error: { message: 'max_tokens_exceeded private-value' } },
        { status: 400 },
      ),
  });
  const error = await client
    .decide({ state: {}, questions: {} }, AbortSignal.timeout(1000))
    .catch((e) => e);
  expect(error.message).toContain('context limit exceeded');
  expect(error.message).not.toContain('private-value');
  expect(error.details.retryable).toBe(false);
});
