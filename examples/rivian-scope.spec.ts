import { test, expect } from '@playwright/test';
import { createJev, type DecisionEvent } from '../src';

test('resolve the contact section without including payment or delivery', async ({
  page,
}, testInfo) => {
  const decisions: DecisionEvent[] = [];
  const jev = createJev(page, {
    onDecision(event) {
      decisions.push(event);
      console.log(JSON.stringify(event.response.answers));
    },
  });
  try {
    await page.goto('https://rivian.com/configurations/reserve/r2');
    await expect(
      page.getByRole('heading', { name: 'Contact information', exact: true }),
    ).toBeVisible();
    const scope = await jev.resolve('Contact information section', {
      kind: 'container',
    });
    await expect(
      scope.getByRole('heading', { name: 'Contact information', exact: true }),
    ).toHaveCount(1);
    await expect(
      scope.getByRole('textbox', { name: 'First name', exact: true }),
    ).toHaveCount(1);
    await expect(
      scope.getByRole('textbox', { name: 'Last name', exact: true }),
    ).toHaveCount(1);
    await expect(
      scope.getByRole('heading', { name: 'Payment', exact: true }),
    ).toHaveCount(0);
    await expect(
      scope.getByRole('heading', { name: 'Delivery address', exact: true }),
    ).toHaveCount(0);
  } finally {
    await testInfo.attach('jev-decisions.json', {
      body: JSON.stringify(decisions, null, 2),
      contentType: 'application/json',
    });
  }
});
