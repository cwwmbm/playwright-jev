import { expect, test } from '@playwright/test';
import {
  createJev,
  JevError,
  OpenRouterProvider,
  type Candidate,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionResponse,
} from '../src';

function choice(
  request: DecisionRequest,
  selected: string,
  probability = 1,
): DecisionResponse {
  const q = request.questions.target!;
  if (q.type !== 'choice') throw new Error('Expected choice');
  const keys = Object.keys(q.criteria);
  return {
    model: 'fake',
    answers: {
      target: {
        type: 'choice',
        choice: selected,
        confidence: probability,
        probabilities: Object.fromEntries(
          keys.map((key) => [
            key,
            key === selected
              ? probability
              : (1 - probability) / (keys.length - 1),
          ]),
        ),
      },
    },
  };
}

function provider(
  pick: (candidates: Candidate[]) => string,
  before?: () => Promise<void>,
): DecisionProvider {
  return {
    async decide(request) {
      const candidates = (request.state as { candidates: Candidate[] })
        .candidates;
      const selected = pick(candidates);
      await before?.();
      return choice(request, selected);
    },
  };
}

test('scopes identical buttons and keeps user values out of requests', async ({
  page,
}) => {
  await page.setContent(
    '<section aria-label="Billing"><button>Save</button></section><section aria-label="Notifications"><input aria-label="Email" value="private@example.test"><button onclick="this.textContent=\'Saved\'">Save</button></section>',
  );
  const jev = createJev(page, {
    provider: provider((candidates) => {
      expect(JSON.stringify(candidates)).not.toContain('private@example.test');
      return (
        candidates.find((c) => c.name === 'Notifications')?.id ??
        candidates.find((c) => c.name === 'Save')!.id
      );
    }),
  });
  await jev.within('notification settings').click('save');
  await expect(
    page.getByRole('region', { name: 'Notifications' }).getByRole('button'),
  ).toHaveText('Saved');
  await expect(
    page.getByRole('region', { name: 'Billing' }).getByRole('button'),
  ).toHaveText('Save');
});

test('refuses uncertain or absent targets without clicking', async ({
  page,
}) => {
  await page.setContent(
    '<button onclick="this.textContent=\'clicked\'">Save</button><button>Cancel</button>',
  );
  const uncertain = createJev(page, {
    provider: {
      async decide(request) {
        return choice(request, 'e0', 0.55);
      },
    },
  });
  await expect(uncertain.click('save')).rejects.toMatchObject({
    code: 'AMBIGUOUS',
  });
  const absent = createJev(page, { provider: provider(() => 'none') });
  await expect(absent.click('delete')).rejects.toMatchObject({
    code: 'NO_MATCH',
  });
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeVisible();
});

test('does not retarget a replacement node during inference', async ({
  page,
}) => {
  await page.setContent('<button>Save</button>');
  const jev = createJev(page, {
    provider: provider(
      (candidates) => candidates[0]!.id,
      async () => {
        await page.locator('button').evaluate((el) => {
          el.outerHTML = '<button>Delete</button>';
        });
      },
    ),
  });
  await expect(jev.click('save')).rejects.toMatchObject({
    code: 'STALE_TARGET',
  });
});

test('rejects a changed target even when its node survives', async ({
  page,
}) => {
  await page.setContent('<button>Save</button>');
  const jev = createJev(page, {
    provider: provider(
      (candidates) => candidates[0]!.id,
      async () => {
        await page.locator('button').evaluate((el) => {
          el.textContent = 'Delete';
        });
      },
    ),
  });
  await expect(jev.click('save')).rejects.toMatchObject({
    code: 'STALE_TARGET',
  });
});

test('rejects cloned nodes even if they copy the internal marker', async ({
  page,
}) => {
  await page.setContent('<button>Save</button>');
  const jev = createJev(page, {
    provider: provider(
      (candidates) => candidates[0]!.id,
      async () => {
        await page
          .locator('button')
          .evaluate((el) => el.replaceWith(el.cloneNode(true)));
      },
    ),
  });
  await expect(jev.click('save')).rejects.toMatchObject({
    code: 'STALE_TARGET',
  });
});

test('fills fields and sets a checkbox with native Playwright actions', async ({
  page,
}) => {
  await page.setContent(
    '<label>Email<input></label><label>Marketing<input type="checkbox"></label>',
  );
  const jev = createJev(page, {
    provider: provider((candidates) => candidates[0]!.id),
  });
  await jev.fill('email', 'a@example.test');
  await jev.setChecked('marketing', true);
  await expect(page.getByRole('textbox')).toHaveValue('a@example.test');
  await expect(page.getByRole('checkbox')).toBeChecked();
});

test('candidate overflow requires explicit scoping', async ({ page }) => {
  await page.setContent('<button>Save</button>'.repeat(255));
  const jev = createJev(page, {
    provider: {
      decide() {
        throw new Error('Provider must not be called');
      },
    },
  });
  await expect(jev.click('save')).rejects.toMatchObject({
    code: 'TOO_MANY_CANDIDATES',
  });
});

test('discovers collection members and rejects partial uncertainty', async ({
  page,
}) => {
  await page.setContent(
    '<article><h2>One</h2><button>Add</button></article><article><h2>Two</h2><button>Add</button></article>',
  );
  const jev = createJev(page, {
    provider: {
      async decide(request) {
        return {
          model: 'fake',
          answers: Object.fromEntries(
            Object.keys(request.questions).map((id) => [
              id,
              { type: 'noul' as const, noul: 1 },
            ]),
          ),
        };
      },
    },
  });
  const cards = await jev.all('product cards');
  expect(cards).toHaveLength(2);
  await expect(cards[1]!).toContainText('Two');
  const uncertain = createJev(page, {
    provider: {
      async decide(request) {
        return {
          model: 'fake',
          answers: Object.fromEntries(
            Object.keys(request.questions).map((id, i) => [
              id,
              { type: 'noul' as const, noul: i === 0 ? 1 : 0.6 },
            ]),
          ),
        };
      },
    },
  });
  await expect(uncertain.all('product cards')).rejects.toMatchObject({
    code: 'AMBIGUOUS',
  });
});

test('text extraction preserves boundaries and excludes enclosing layout wrappers', async ({
  page,
}) => {
  await page.setContent(
    '<main><div><h4>Accepted accounts</h4>alice<br>bob</div><div><h4>Password</h4>public-demo</div><textarea>private default</textarea></main>',
  );
  const jev = createJev(page, {
    provider: provider((candidates) => {
      expect(candidates.some((c) => c.tag === 'main')).toBe(false);
      expect(JSON.stringify(candidates)).not.toContain('private default');
      const list = candidates.find(
        (c) => c.text === 'Accepted accounts alice bob',
      );
      expect(list).toBeDefined();
      return list!.id;
    }),
  });
  await expect(await jev.resolve('accounts', { kind: 'text' })).toContainText(
    'alice',
  );
});

test('OpenRouter uses Decisions API and validates responses', async () => {
  const request: DecisionRequest = {
    state: {},
    questions: {
      target: {
        type: 'choice',
        instructions: 'Pick',
        criteria: { e0: 'Save', none: 'No match' },
      },
    },
  };
  const client = new OpenRouterProvider({
    apiKey: 'test-secret',
    fetch: async (url, init) => {
      expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
      expect(JSON.parse(init!.body as string)).toMatchObject({
        model: 'typesafe/jev-1.13',
        ...request,
      });
      return Response.json(choice(request, 'e0'));
    },
  });
  expect(
    (await client.decide(request, AbortSignal.timeout(1000))).answers.target,
  ).toMatchObject({ choice: 'e0' });
  const malformed = new OpenRouterProvider({
    apiKey: 'test-secret',
    fetch: async () =>
      Response.json({
        model: 'fake',
        answers: { target: { type: 'choice', choice: 'invented' } },
      }),
  });
  await expect(
    malformed.decide(request, AbortSignal.timeout(1000)),
  ).rejects.toBeInstanceOf(JevError);
  const unavailable = new OpenRouterProvider({
    apiKey: 'test-secret',
    fetch: async () => new Response('test-secret', { status: 429 }),
  });
  await expect(
    unavailable.decide(request, AbortSignal.timeout(1000)),
  ).rejects.toThrow('HTTP 429');
});

test('read returns exact selected text with price context', async ({
  page,
}) => {
  await page.setContent(
    '<article><div><a><span>Premium coat</span></a></div><div>$49.99<button>Add</button></div></article>',
  );
  const jev = createJev(page, {
    provider: provider((candidates) => {
      const name = candidates.find((c) => c.text === 'Premium coat')!;
      expect(name.ancestors?.some((a) => a.text.includes('$49.99'))).toBe(true);
      return name.id;
    }),
  });
  expect(await jev.read('name of most expensive product')).toBe('Premium coat');
});

for (const [probability, error] of [
  [0.99, null],
  [0.02, 'VERIFICATION_FAILED'],
  [0.6, 'AMBIGUOUS'],
] as const) {
  test(`semantic verify handles probability ${probability} in one request`, async ({
    page,
  }) => {
    await page.setContent('<h1>Cart</h1><article>Premium coat</article>');
    let calls = 0;
    const jev = createJev(page, {
      provider: {
        async decide(request) {
          calls++;
          expect(request.state).toMatchObject({
            facts: { expectedItem: 'Premium coat' },
          });
          return {
            model: 'fake',
            answers: { verified: { type: 'noul', noul: probability } },
          };
        },
      },
    });
    const judgment = jev.verify('cart contains expectedItem', {
      expectedItem: 'Premium coat',
    });
    if (error) await expect(judgment).rejects.toMatchObject({ code: error });
    else expect(await judgment).toEqual({ probability, model: 'fake' });
    expect(calls).toBe(1);
  });
}

test('verification rejects page evidence changed during inference', async ({
  page,
}) => {
  await page.setContent('<h1>Cart</h1><p>Premium coat</p>');
  const jev = createJev(page, {
    provider: {
      async decide() {
        await page.locator('p').evaluate((el) => {
          el.textContent += ' changed';
        });
        return {
          model: 'fake',
          answers: { verified: { type: 'noul', noul: 1 } },
        };
      },
    },
  });
  await expect(jev.verify('cart contains Premium coat')).rejects.toMatchObject({
    code: 'STALE_TARGET',
  });
});

test('retries transient failures with fresh timeout signals and clicks only once', async ({
  page,
}) => {
  await page.setContent(
    '<button onclick="this.dataset.clicks=String(Number(this.dataset.clicks || 0)+1)">Save</button>',
  );
  let calls = 0;
  const signals: AbortSignal[] = [];
  const jev = createJev(page, {
    apiKey: 'test-key',
    timeoutMs: 1000,
    retryDelayMs: 0,
    fetch: async (_url, init) => {
      calls++;
      signals.push(init!.signal!);
      if (calls === 1) return new Response('', { status: 503 });
      if (calls === 2)
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => reject(new Error('timeout')),
            { once: true },
          );
        });
      const request = JSON.parse(init!.body as string) as DecisionRequest;
      return Response.json(choice(request, 'e0'));
    },
  });
  await jev.click('save');
  expect(calls).toBe(3);
  expect(new Set(signals).size).toBe(3);
  await expect(page.locator('button')).toHaveAttribute('data-clicks', '1');
});

for (const [status, expectedCalls] of [
  [503, 3],
  [401, 1],
] as const) {
  test(`HTTP ${status} obeys retry limits`, async ({ page }) => {
    await page.setContent('<button>Save</button>');
    let calls = 0;
    const jev = createJev(page, {
      apiKey: 'test-key',
      retryDelayMs: 0,
      fetch: async () => {
        calls++;
        return new Response('', { status });
      },
    });
    await expect(jev.click('save')).rejects.toThrow(`HTTP ${status}`);
    expect(calls).toBe(expectedCalls);
  });
}

test('container evidence distinguishes own heading from surrounding sections', async ({
  page,
}) => {
  await page.setContent(
    '<main><div><div data-testid="contact"><h2>Contact information</h2><div><label>First name<input></label></div></div><div><h2>Delivery address</h2><input></div><div><h2>Payment</h2><input></div></div></main>',
  );
  const jev = createJev(page, {
    provider: provider((candidates) => {
      const contact = candidates.find(
        (c) => c.structure?.directHeadings?.[0] === 'Contact information',
      )!;
      expect(contact.name).toBe('Contact information');
      expect(contact.structure?.descendantHeadings).toEqual([
        'Contact information',
      ]);
      expect(
        candidates.some(
          (c) =>
            c.structure?.descendantHeadings?.includes('Payment') &&
            c.structure.descendantHeadings.includes('Contact information'),
        ),
      ).toBe(true);
      return contact.id;
    }),
  });
  await expect(
    await jev.resolve('Contact information section', { kind: 'container' }),
  ).toHaveAttribute('data-testid', 'contact');
});

test('re-resolves an unchanged section once when surrounding deposit text loads', async ({
  page,
}) => {
  await page.setContent(
    '<main><section><h2>Contact information</h2><label>Name<input></label></section><p>Deposit CAD</p></main>',
  );
  let calls = 0;
  const jev = createJev(page, {
    provider: provider(
      (candidates) => {
        calls++;
        return candidates.find(
          (c) => c.structure?.directHeadings?.[0] === 'Contact information',
        )!.id;
      },
      async () => {
        await page.locator('p').evaluate((el) => {
          el.textContent = 'Refundable deposit $150 CAD';
        });
      },
    ),
  });
  const section = await jev.resolve('Contact information section', {
    kind: 'container',
  });
  await expect(section.getByLabel('Name')).toHaveCount(1);
  expect(calls).toBe(2);
});

test('context retry is bounded on a continuously changing page', async ({
  page,
}) => {
  await page.setContent(
    '<section><h2>Contact</h2><input></section><p>Loading</p>',
  );
  let calls = 0;
  const jev = createJev(page, {
    provider: provider(
      (candidates) => {
        calls++;
        return candidates.find(
          (c) => c.structure?.directHeadings?.[0] === 'Contact',
        )!.id;
      },
      async () => {
        await page.locator('p').evaluate((el) => {
          el.textContent += '.';
        });
      },
    ),
  });
  await expect(
    jev.resolve('Contact', { kind: 'container' }),
  ).rejects.toMatchObject({ code: 'STALE_TARGET' });
  expect(calls).toBe(2);
});

test('changed price context is re-evaluated before clicking, not ignored', async ({
  page,
}) => {
  await page.setContent(
    '<article><span>$10</span><button onclick="this.textContent=\'Clicked\'">Add</button></article><article><span>$20</span><button onclick="this.textContent=\'Clicked\'">Add</button></article>',
  );
  let calls = 0;
  const jev = createJev(page, {
    provider: provider(
      (candidates) => {
        calls++;
        return candidates.find((c) =>
          c.context.includes(calls === 1 ? '$10' : '$20'),
        )!.id;
      },
      async () => {
        await page
          .locator('span')
          .first()
          .evaluate((el) => {
            el.textContent = '$99';
          });
      },
    ),
  });
  await jev.click('add cheapest product');
  expect(calls).toBe(2);
  await expect(page.locator('button').first()).toHaveText('Add');
  await expect(page.locator('button').last()).toHaveText('Clicked');
});
