# playwright-jev

Use semantic descriptions in ordinary Playwright code. Jev selects elements and checks claims; Playwright performs the actions.

## Install

Requires Node.js 20+, Git, and an existing Playwright project with browsers installed.

```sh
npm install github:cwwmbm/playwright-jev dotenv
```

Git installation builds the package automatically, so npm install scripts must be enabled. To pin a version, append `#<commit-sha>` or an existing Git tag.

## Configure

Create `.env` in your Playwright project's root:

```dotenv
OPENROUTER_API_KEY=your-openrouter-api-key
# Optional; this is the default model:
OPENROUTER_MODEL=typesafe/jev-1.13
```

Add `.env` to `.gitignore`. Load it from your `playwright.config.ts`:

```ts
import 'dotenv/config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
});
```

The library reads environment variables but does not load `.env` itself. For standalone scripts, add `import 'dotenv/config'` to the script instead. Live decisions use your OpenRouter account and incur API charges.

## Quick start

```ts
import { test } from '@playwright/test';
import { createJev } from 'playwright-jev';

test('add the most expensive product', async ({ page }) => {
  const jev = createJev(page);
  await page.goto('https://www.saucedemo.com/');

  await jev.fill('username', 'standard_user');
  await jev.fill('password', 'secret_sauce');
  await jev.click('log in');

  const item = await jev.read('the name of the most expensive item');
  await jev.click('add to cart on the most expensive item');
  await jev.click('go to shopping cart');
  await jev.verify('the cart contains exactly one item named expectedItem', {
    expectedItem: item,
  });
});
```

Run with `npx playwright test`, or add `--headed` to see the browser.

## Commands

### `createJev(page, options?)`

Use your existing Playwright page. Credentials and model default to the environment settings above.

```ts
const jev = createJev(page, {
  timeoutMs: 30_000,
  minProbability: 0.85,
  minMargin: 0.2,
  maxRetries: 2, // Transient provider failures only.
});
```

### `click(intent)`

Find and click the matching control.

```ts
await jev.click('add to cart on the most expensive item');
```

### `fill(intent, value)`

Fill a single text field.

```ts
await jev.fill('email address', 'andrey@example.com');
```

### `fillForm(values)`

Map descriptive field names to text fields, native dropdowns, or checkboxes. This does not submit the form.

```ts
await jev.within('shipping address form').fillForm({
  'full name': 'Andrey Popov',
  'street address': '123 Main St',
  city: 'Vancouver',
  province: 'British Columbia',
  'postal code': 'V6B 1A1',
  'save this address': true,
});
```

Use strings for text fields and native single-select dropdowns; booleans for native checkboxes. Custom dropdown widgets are not supported. Fill dependent dropdowns in separate calls so newly loaded options are available.

### `setChecked(intent, checked)`

Set a checkbox to the requested state.

```ts
await jev.setChecked('receive marketing emails', false);
```

### `read(intent)`

Return the exact text of the selected element, rather than a generated answer.

```ts
const productName = await jev.read('the name of the most expensive product');
```

### `verify(claim, facts?)`

Check a claim against page evidence. Returns a probability and model on success; throws on a negative or uncertain result. Optional facts supply expected values.

```ts
const result = await jev.verify('the cart contains expectedItem', {
  expectedItem: productName,
});
console.log(result.probability);

await jev.verify('the order confirmation message is on the page');
```

Verification uses DOM text and context, not screenshots or input values. For exact control state, resolve the element and use a Playwright assertion.

### `within(scope)`

Limit subsequent commands to a semantic section or a Playwright locator. Helpful for large pages and repeated controls.

```ts
const shipping = jev.within('shipping address section');
await shipping.fill('city', 'Vancouver');

const dialog = jev.within(page.getByRole('dialog'));
await dialog.click('cancel');
```

### `resolve(intent, options?)`

Return a native Playwright locator for an assertion or custom action. The default kind is `click`.

```ts
import { expect } from '@playwright/test';

const button = await jev.resolve('confirm reservation button', {
  kind: 'text',
});
await expect(button).toBeDisabled();
```

Kinds: `click`, `fill`, `check`, `container`, `text`, `form`, and `select`.

### `all(intent, options?)`

Return locators for matching collection members. The default kind is `container`.

```ts
const cards = await jev.all('product cards');
for (const card of cards) {
  console.log(await card.innerText());
}
```

Returned locators refer to the selected nodes; they do not re-run Jev after the page changes. Uncertain collection membership throws instead of returning a partial result.

## Track execution cost

Collect provider-reported USD costs through `onDecision`. Use `finally` to print the total even if a step fails.

```ts
let reportedCost = 0;
let decisions = 0;
const jev = createJev(page, {
  onDecision({ response }) {
    reportedCost += response.usage?.cost ?? 0;
    decisions += 1;
  },
});

try {
  await jev.click('open shopping cart');
} finally {
  console.log(
    `Reported cost: $${reportedCost.toFixed(8)} (${decisions} decisions)`,
  );
}
```

This total excludes attempts for which the provider returned no cost.

## Behavior to know

- Commands reject missing, uncertain, or stale targets. Browser actions are never automatically repeated.
- Use `within()` when a page exceeds the candidate or model context limit.
- Semantic verification is a model judgment; use Playwright assertions when you need exact state checks.
- Page text and context are sent to OpenRouter. Text values supplied to `fill`/`fillForm` are passed directly to Playwright; requested dropdown values are sent to Jev.
- `fillForm` validates mappings before writing, but later failures do not roll back fields already filled.
