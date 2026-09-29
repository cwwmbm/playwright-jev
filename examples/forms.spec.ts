import { test, expect } from '@playwright/test';
import { createJev, type DecisionEvent } from '../src';

test('fill a shipping form semantically', async ({ page }, testInfo) => {
  await page.setContent(`<form aria-label="Shipping address">
    <label>Recipient<input name="recipient"></label>
    <label>Street address<input name="street"></label>
    <label>City<input name="city"></label>
    <label>Province<select name="province"><option value="">Choose province</option><option value="BC">British Columbia</option><option value="ON">Ontario</option></select></label>
    <label>Postal code<input name="postal"></label>
    <button type="submit">Continue</button>
  </form>`);
  const decisions: DecisionEvent[] = [];
  const jev = createJev(page, {
    onDecision: (event) => {
      decisions.push(event);
    },
  });
  try {
    await jev.within('shipping address form').fillForm({
      fullName: 'Andrey Popov',
      streetAddress: '123 Main St',
      city: 'Vancouver',
      province: 'BC',
      postalCode: 'V6B 1A1',
    });
    await expect(page.getByLabel('Recipient')).toHaveValue('Andrey Popov');
    await expect(page.getByLabel('Street address')).toHaveValue('123 Main St');
    await expect(page.getByLabel('City')).toHaveValue('Vancouver');
    await expect(page.getByLabel('Province')).toHaveValue('BC');
    await expect(page.getByLabel('Postal code')).toHaveValue('V6B 1A1');
  } finally {
    await testInfo.attach('jev-decisions.json', {
      body: JSON.stringify(decisions, null, 2),
      contentType: 'application/json',
    });
  }
});
