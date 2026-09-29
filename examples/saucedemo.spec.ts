import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createJev, type DecisionEvent } from '../src';

test('add the most expensive product and verify the cart', async ({
  page,
}, testInfo) => {
  const decisions: DecisionEvent[] = [];
  let retriedRequests = 0;
  const jev = createJev(page, {
    onRetry({ intent, attempt, error }) {
      retriedRequests++;
      console.log(
        `Retrying Jev decision ${JSON.stringify(intent)} (attempt ${attempt}): ${error.message}`,
      );
    },
    onDecision(event) {
      decisions.push(event);
      console.log(
        `${event.kind}: ${event.intent} (${event.candidateCount} candidates, ${event.elapsedMs}ms)`,
      );
    },
  });
  try {
    await page.goto('https://www.saucedemo.com/');
    // Read the public demo credentials from the current page, not constants.
    const usernames = await jev.resolve(
      'list of accepted usernames for this demo',
      { kind: 'text' },
    );
    const usernameText = await usernames.innerText();
    const username = usernameText.match(/\bstandard_user\b/)?.[0];
    expect(
      username,
      'baseline account must be advertised on the page',
    ).toBeTruthy();
    const passwordBlock = await jev.resolve(
      'shared password for all demo users',
      { kind: 'text' },
    );
    const passwordText = await passwordBlock.innerText();
    const password = passwordText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1)!;
    expect(password).not.toMatch(/password.*:/i);
    await jev.fill('username', username!);
    await jev.fill('password', password);
    await jev.click('log in');
    await expect(page).toHaveURL(/inventory\.html/);

    const itemName = await jev.read(
      'the name of the most expensive item in the store',
    );
    await jev.click('add to cart on the most expensive item in the store');
    await jev.click('go to shopping cart');

    const verdict = await jev.verify(
      'the shopping cart contains exactly one item, whose product name is expectedItem, with quantity one',
      {
        expectedItem: itemName,
      },
    );
    console.log(
      `Jev verified: ${itemName} (probability ${verdict.probability})`,
    );
    await testInfo.attach('semantic-result.json', {
      body: JSON.stringify({ itemName, verdict }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    const reportedCosts = decisions
      .map((event) => event.response.usage?.cost)
      .filter(
        (cost): cost is number =>
          typeof cost === 'number' && Number.isFinite(cost) && cost >= 0,
      );
    const totalCost = reportedCosts.reduce((sum, cost) => sum + cost, 0);
    const missingCosts = decisions.length - reportedCosts.length;
    if (retriedRequests)
      console.log(
        `${retriedRequests} API retries; costs of attempts without a response are unknown and excluded.`,
      );
    console.log(
      `Jev reported API cost: $${totalCost.toFixed(8)} USD across ${decisions.length} decisions` +
        (missingCosts
          ? ` (${missingCosts} missing cost reports; subtotal only)`
          : ''),
    );
    await writeFile(
      testInfo.outputPath('jev-decisions.json'),
      JSON.stringify(decisions, null, 2),
    );
    await testInfo.attach('jev-decisions.json', {
      body: JSON.stringify(decisions, null, 2),
      contentType: 'application/json',
    });
  }
});
