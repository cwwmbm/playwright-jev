import { test, expect } from '@playwright/test';
import { createJev } from '../src';

// Live negative controls: assess whether Jev rejects claims instead of only testing agreement.
for (const [label, body] of [
  [
    'wrong product',
    '<h1>Shopping cart</h1><article><h2>Canvas bag</h2><p>Quantity: 1</p><p>$12.00</p></article>',
  ],
  ['empty cart', '<h1>Shopping cart</h1><p>Your cart is empty.</p>'],
] as const) {
  test(`semantic verification rejects ${label}`, async ({ page }, testInfo) => {
    await page.setContent(body);
    const attachments: Promise<void>[] = [];
    const jev = createJev(page, {
      onDecision(event) {
        console.log(`${label}: ${JSON.stringify(event.response.answers)}`);
        attachments.push(
          testInfo.attach('decision.json', {
            body: JSON.stringify(event, null, 2),
            contentType: 'application/json',
          }),
        );
      },
    });
    try {
      await expect(
        jev.verify(
          'the shopping cart contains the product named expectedItem',
          {
            expectedItem: 'Premium coat',
          },
        ),
      ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    } finally {
      await Promise.all(attachments);
    }
  });
}
