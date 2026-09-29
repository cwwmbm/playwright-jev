# playwright-jev

An experimental TypeScript package for code-authored, semantically located Playwright automation. Jev selects DOM elements through OpenRouter's Decisions API; Playwright executes actions. Ordinary code owns sequencing; Jev can select comparative targets, read text, and verify claims semantically.

## Install from GitHub

Install from [cwwmbm/playwright-jev](https://github.com/cwwmbm/playwright-jev) into your Playwright project:

```sh
npm install github:cwwmbm/playwright-jev
```

Then import `createJev` from `playwright-jev` as usual. Git must be available. An SSH alternative is `npm install git+ssh://git@github.com/cwwmbm/playwright-jev.git`; private repositories require GitHub authentication on the consuming machine.

For reproducible installs, append `#<commit-sha>` or an existing release tag. For example, once `v0.1.0` is published as a Git tag, use `npm install github:cwwmbm/playwright-jev#v0.1.0`.

The `prepare` lifecycle builds JavaScript and TypeScript declarations during Git installation. Build tools are dev dependencies and are installed for that preparation. Install scripts must be permitted by your npm configuration; `--ignore-scripts` prevents this source-only Git package from building. Consumers need Node 20+, their existing Playwright project/browser setup, and `OPENROUTER_API_KEY` at runtime. No key is needed to install or build. The library does not load `.env` automatically.

Commit source, build configuration and `package-lock.json`. Keep `dist`, `.env`, `node_modules`, browser artifacts and tarballs out of Git. For a fresh development checkout:

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run verify:git
```

`verify:git` creates a temporary Git repository from package inputs, installs its exact commit into an independent consumer without prebuilt artifacts, and checks ESM/CommonJS execution, TypeScript declarations and package contents. It uses npm registry access but no live Jev API calls. Temporary verification directories are printed for inspection.

GitHub Actions runs library checks on Node 20, 22 and 24. Live website examples and credentials are excluded from CI. Release by updating the package version/lockfile, committing, tagging that commit (for example `v0.1.0`), and pushing the tag. Consumers should pin a tag or commit and commit their own lockfile. Nothing automatically publishes to npm.

The package is currently marked `UNLICENSED`; an open-source license has not been selected. The optional local cost reporter is not part of the package exports; consumers can aggregate `onDecision` events themselves.

## Run this project

Requires Node.js 20+ and an OpenRouter API key with access to `typesafe/jev-1.13`.

```sh
npm install
npx playwright install chromium
# Set OPENROUTER_API_KEY in .env (see .env.example).
npm test
npm run test:demo
# Optional visible browser:
npm run test:demo:headed
```

The SauceDemo example reads the site's advertised credentials, logs in as `standard_user`, asks Jev for the most expensive product's name, asks it to click that product's add-to-cart button, opens the cart, and asks Jev to verify the memorized item is present. There is no programmed price ranking or deterministic cart assertion. It does not check out. Live runs incur OpenRouter usage; local tests use an injected provider.

```ts
const itemName = await jev.read(
  'the name of the most expensive item in the store',
);
await jev.click('add to cart on the most expensive item in the store');
await jev.click('go to shopping cart');
await jev.verify('the cart contains the expected item', {
  expectedItem: itemName,
});
```

`read` asks Jev to choose a text element and returns that element's exact rendered text. It does not generate an answer or compute a maximum. Nearby ancestor context gives product names and controls access to prices. `verify` makes a Noul judgment about observed text and expected facts. It returns `{ probability, model }` on acceptance and throws `VERIFICATION_FAILED` for a clear negative or `AMBIGUOUS` for uncertainty. It uses the configured `minProbability` threshold.

Verification retries once only when page evidence changes during inference; both decisions appear in diagnostics. It never retries negative or uncertain judgments until they pass. Facts are expected values, not evidence of success. Empty text scopes fail with `NO_MATCH`. Verification currently observes DOM text and bounded context, not pixel appearance, input values or all possible application state.

A passing semantic test is Jev's judgment, not independent proof of correctness. The demo saves candidate evidence, expected facts and model probabilities in `test-results` for review. The separate live verification controls exercise a wrong expected item and an empty cart.

## Install into another project

The package is not published to npm yet. Build a real installable tarball:

```sh
npm pack
# In an existing Playwright project:
npm install /absolute/path/to/playwright-jev-0.1.0.tgz
```

`playwright-core` is a peer dependency. The package neither installs browser binaries nor creates a browser session. It accepts the consumer's existing `Page`, including pages from standalone Playwright scripts. ESM, CommonJS and TypeScript declarations are included.

```ts
import { createJev } from 'playwright-jev';

const jev = createJev(page, {
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'typesafe/jev-1.13',
});

await jev.fill('username', 'standard_user');
await jev.fill('password', password);
await jev.click('log in');

const preferences = jev.within('notification settings section');
await preferences.setChecked('promotional emails', false);
await preferences.click('save preferences');

// Native scopes are also accepted:
await jev.within(page.getByRole('dialog')).click('confirm');

// Resolve without acting; useful for inspecting a choice or reading a value:
const name = await jev.resolve('product name', { kind: 'text' });
console.log(await name.innerText());

// Collection membership is independently evaluated for every candidate:
const cards = await jev.all('complete product cards');
```

## API and behavior

- `createJev(page, options?)`: configure the provider and acceptance policy.
- `within(string | Locator)`: scope later calls. String scopes are re-resolved on each operation.
- `click(intent)`, `fill(intent, value)`, `setChecked(intent, boolean)`: resolve once, validate freshness and use native Playwright actions.
- `read(intent)`: select and copy a text element.
- `verify(claim, facts?)`: semantically judge current page evidence against a claim and expected scalar facts.
- `resolve(intent, { kind? })`: return a snapshot-bound native Locator. Default kind is `click`; other kinds are `fill`, `check`, `container` and `text`.
- `all(intent, { kind? })`: return snapshot-bound Locators for collection members. Default kind is `container`. Uncertain memberships cause an error rather than silently returning a partial set.

Native locators returned by `resolve`/`all` do not perform future semantic resolution or freshness checks. Use action helpers to resolve immediately before acting. Helpers never retry a potentially completed action. They fail on a target that disappears, changes its bounded metadata, or is replaced during inference. Re-resolution after a target change is the caller's responsibility. The DOM can still change after the freshness check, so assertions remain necessary.

The default adapter posts to `https://openrouter.ai/api/alpha/decisions`. It uses `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (also accepts `JEV_MODEL`), with `typesafe/jev-1.13` as the model default. The endpoint is fixed to OpenRouter; this prototype does not read `OPENROUTER_DECISIONS_URL`. The library itself does not load `.env`; the example's Playwright configuration does.

Options:

| Option           | Default             | Meaning                                                                                                        |
| ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apiKey`         | Environment         | OpenRouter credential, used only in Node                                                                       |
| `model`          | `typesafe/jev-1.13` | Model ID                                                                                                       |
| `timeoutMs`      | `30000`             | Per request, root wait, or native action timeout; not a whole-operation deadline                               |
| `minProbability` | `0.85`              | Minimum selected probability or collection membership                                                          |
| `minMargin`      | `0.2`               | Minimum probability gap to the next Choice option                                                              |
| `onDecision`     | None                | Callback with candidate evidence, expected facts, probabilities, model, duration and reported token/cost usage |
| `redact`         | None                | Transform candidate metadata before transmission; preserve IDs                                                 |
| `provider`       | OpenRouter          | Inject a `DecisionProvider` for tests or another backend                                                       |

Thresholds are experimental defaults, not calibrated correctness guarantees. Errors are `JevError` with codes `CONFIG`, `NO_MATCH`, `AMBIGUOUS`, `TOO_MANY_CANDIDATES`, `STALE_TARGET`, `PROVIDER`, `INVALID_RESPONSE` or `VERIFICATION_FAILED`. Native Playwright action failures propagate unchanged. Transient provider failures (network errors, request/body timeouts, HTTP 408, 429, 500, 502, 503 and 504) retry up to twice with a fresh timeout and exponential backoff. Authentication errors, invalid responses, negative judgments and browser actions are not retried. Each decision can therefore take up to three request timeouts plus backoff. Retry attempts with no response may have unknown charges; the demo reports only returned costs.

## Current boundaries

- DOM-based, no screenshots or visual reasoning. Names use a limited approximation of accessible-name rules (ARIA labels/references, labels, alt text and visible text). This is not a complete accessibility-tree implementation.
- Up to 254 candidates per operation. Narrow larger pages with `within`; candidates are never silently dropped to fit the limit.
- Metadata text is bounded (names 300, element text 800, parent context 1000 characters, plus three ancestor text blocks of up to 1200 characters each). Hidden descendant text can appear in container metadata; this is a DOM snapshot, not an exact visual snapshot.
- Input values, textarea/select content and editable content are omitted. Nearby text, labels and selected attributes still leave the machine; use `redact` for sensitive pages. Diagnostic callbacks contain intent and model results. Playwright traces can include page data.
- A namespaced DOM attribute plus a page-local WeakMap bind selections to observed nodes. Attributes remain for the lifetime of the page. Ordinary CSS-rendered DOM controls are the initial target; frames, closed shadow roots, canvas controls, virtualized/offscreen discovery and arbitrary custom widgets are not supported as a complete contract.
- No persistent decision cache, automatic navigation planning or general-purpose agent loop.
- Collection results depend on model recall; exact assertions and application-specific coverage checks are still important.

## Development

```sh
npm run typecheck
npm run build
npm test
npm run format:check
```

Local tests cover scoped duplicate controls, missing/uncertain matches, stale/replaced/cloned nodes, field-value exclusion, native fill/check actions, collection membership, overflow and response validation. The live example attaches decisions and product selection to Playwright results.

References: [OpenRouter Jev guide](https://openrouter.ai/docs/guides/community/jev), [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice), [TypeSafe semantic search cookbook](https://docs.typesafe.ai/cookbooks/semantic_find).

Retry options: `maxRetries` (default `2`, range 0–5), `retryDelayMs` (default `500`, doubled per retry up to 10 seconds), and `onRetry({ intent, attempt, delayMs, error })`. Set `maxRetries: 0` to disable. The demo prints retry notices.

## Fill a whole form

```ts
await jev.within('shipping address form').fillForm({
  fullName: 'Andrey Popov',
  streetAddress: '123 Main St',
  city: 'Vancouver',
  province: 'BC',
  postalCode: 'V6B 1A1',
});
```

`fillForm(values)` accepts an object mapping semantic field descriptions to strings (text inputs, textareas, editable elements or native single-select dropdowns), or booleans (native checkboxes). Jev maps all field names in one request, then semantically resolves each dropdown's requested value against its option labels/values. Text input values are passed directly to Playwright, not to Jev; dropdown requested values and option metadata are sent to Jev. Candidate redaction applies to both mapping and option selection.

All field mappings, duplicate-target checks, dropdown choices and target freshness checks complete before any write. Missing or uncertain mappings fail without filling anything. Native dropdowns only: custom comboboxes, multi-selects and free-form address parsing are not supported. Disabled/read-only controls are excluded. An empty object is a no-op. At most 254 supplied fields, candidate controls or enabled dropdown options are supported per corresponding decision.

Execution follows object insertion order and never submits the form. If a later action fails or the page replaces a control, earlier writes are not rolled back: error `details.completedFields` and `details.failedField` identify progress without echoing supplied values. Native action failures use `FORM_FILL_FAILED`. For dependent dropdowns (e.g. choosing a country populates provinces), use separate calls so the second mapping sees the new options. Native input formats still apply to dates and numbers; no value conversion is performed.

Run the live, website-independent form fixture with:

```sh
npx playwright test --project=saucedemo forms.spec.ts
```

The OpenRouter adapter factors repeated long strings into a shared-text table before transmission. This preserves every candidate and text value while reducing duplicated context on large pages. Diagnostics retain the expanded candidate evidence. Pages can still exceed the model's context limit; recognized `max_tokens_exceeded` responses now explicitly recommend narrowing with `within()` instead of reporting only HTTP 400.

Single-element resolution automatically retries once when the same node and its own metadata remain unchanged but surrounding context changes during inference. Jev sees fresh evidence on that second attempt; the old decision is discarded. Changed/replaced targets still fail, and browser actions are never repeated by this recovery. Continuously changing context fails after the second attempt. Both returned decisions are logged and counted in reported cost.
