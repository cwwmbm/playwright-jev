import { test, expect } from '@playwright/test';
import {
  createJev,
  type Candidate,
  type DecisionProvider,
  type DecisionResponse,
} from '../src';

function mapper(names: string[]): DecisionProvider {
  return {
    async decide(request) {
      const candidates = (request.state as { candidates: Candidate[] })
        .candidates;
      const answers: DecisionResponse['answers'] = {};
      for (const [id, question] of Object.entries(request.questions)) {
        if (question.type !== 'choice') throw Error('Expected choice');
        const selected =
          id === 'option'
            ? 'o1'
            : (candidates.find((c) => c.name === names[Number(id.slice(5))])
                ?.id ?? 'none');
        answers[id] = {
          type: 'choice',
          choice: selected,
          confidence: 1,
          probabilities: Object.fromEntries(
            Object.keys(question.criteria).map((key) => [
              key,
              key === selected ? 1 : 0,
            ]),
          ),
        };
      }
      return { model: 'fake', answers };
    },
  };
}

test('fills scoped text, dropdown and checkbox without submission', async ({
  page,
}) => {
  await page.setContent(
    '<form aria-label="Shipping"><label>City<input></label><label>Province<select><option>Choose</option><option value="BC">British Columbia</option></select></label><label>Updates<input type="checkbox"></label><button>Submit</button></form><form aria-label="Billing"><label>City<input></label></form>',
  );
  const jev = createJev(page, {
    provider: mapper(['City', 'Province', 'Updates']),
  });
  await jev
    .within(page.getByRole('form', { name: 'Shipping' }))
    .fillForm({ city: 'Vancouver', province: 'BC', updates: true });
  await expect(
    page.getByRole('form', { name: 'Shipping' }).getByLabel('City'),
  ).toHaveValue('Vancouver');
  await expect(page.getByLabel('Province')).toHaveValue('BC');
  await expect(page.getByLabel('Updates')).toBeChecked();
  await expect(
    page.getByRole('form', { name: 'Billing' }).getByLabel('City'),
  ).toHaveValue('');
});

for (const names of [
  ['City', 'Missing'],
  ['City', 'City'],
]) {
  test(`rejects invalid mapping ${names.join('/')} before writing`, async ({
    page,
  }) => {
    await page.setContent('<label>City<input value="original"></label>');
    const jev = createJev(page, { provider: mapper(names) });
    await expect(
      jev.fillForm({ city: 'Vancouver', second: 'Other' }),
    ).rejects.toMatchObject({
      code: names[1] === 'Missing' ? 'NO_MATCH' : 'AMBIGUOUS',
    });
    await expect(page.getByLabel('City')).toHaveValue('original');
  });
}

test('rejects missing dropdown option before filling any field', async ({
  page,
}) => {
  await page.setContent(
    '<label>City<input></label><label>Country<select><option>Canada</option></select></label>',
  );
  const provider = mapper(['City', 'Country']);
  const jev = createJev(page, {
    provider: {
      async decide(request, signal) {
        if (request.questions.option?.type === 'choice')
          return {
            model: 'fake',
            answers: {
              option: {
                type: 'choice',
                choice: 'none',
                confidence: 1,
                probabilities: { none: 1, o0: 0 },
              },
            },
          };
        return provider.decide(request, signal);
      },
    },
  });
  await expect(
    jev.fillForm({ city: 'Vancouver', country: 'Atlantis' }),
  ).rejects.toMatchObject({ code: 'NO_MATCH' });
  await expect(page.getByLabel('City')).toHaveValue('');
});

test('reports partial progress if the form changes during execution', async ({
  page,
}) => {
  await page.setContent(
    '<label>City<input oninput="document.querySelector(\'textarea\').remove()"></label><label>Notes<textarea></textarea></label>',
  );
  const jev = createJev(page, { provider: mapper(['City', 'Notes']) });
  await expect(
    jev.fillForm({ city: 'Vancouver', notes: 'Hello' }),
  ).rejects.toMatchObject({
    code: 'STALE_TARGET',
    details: { completedFields: ['city'], failedField: 'notes' },
  });
});
