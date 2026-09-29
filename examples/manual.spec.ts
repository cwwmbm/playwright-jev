import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createJev, type DecisionEvent } from '../src';

test.only('add the most expensive product and verify the cart', async ({
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
    await page.goto('https://rivian.com/en-CA');

    await jev.click('Dismiss cookies banner');
    await jev.click('Vehicles');
    const navigation = page.getByRole('region', { name: 'Vehicles R1S 7-seat SUV built' });
    await jev.within(navigation).click('Reserve button for the R2');
    await jev.within('Contact information section').fillForm({
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      phone: '1234567890',
    });
    
    await jev.within('Delivery address section').fillForm({
      address: '123 Main St',
      city: 'Vancouver',
      postalCode: 'V6B 1A1',
    });
    await jev.setChecked('I agree to the terms and conditions', true);
    const button = await jev.resolve('confirm reservation', { kind: 'text' });
    await expect(button).toBeDisabled();

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
