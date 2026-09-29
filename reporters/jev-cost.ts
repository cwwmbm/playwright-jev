import { readFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import type { DecisionEvent } from '../src';

/** Aggregate live API costs across tests and Playwright retry attempts. */
export default class JevCostReporter implements Reporter {
  private total = 0;
  private decisions = 0;
  private missing = 0;
  private tests = 0;

  onTestEnd(_test: TestCase, result: TestResult) {
    const attachments = result.attachments.filter((attachment) =>
      ['jev-decisions.json', 'decision.json'].includes(attachment.name),
    );
    if (!attachments.length) return;
    this.tests++;
    for (const attachment of attachments) {
      try {
        const contents =
          attachment.body ??
          (attachment.path ? readFileSync(attachment.path) : undefined);
        if (!contents) {
          this.missing++;
          continue;
        }
        const parsed = JSON.parse(contents.toString()) as
          DecisionEvent | DecisionEvent[];
        for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
          this.decisions++;
          const cost = event.response?.usage?.cost;
          if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0)
            this.total += cost;
          else this.missing++;
        }
      } catch {
        this.missing++;
      }
    }
  }

  onEnd() {
    if (!this.tests) return;
    console.log(
      `\nTotal Jev execution cost (reported): $${this.total.toFixed(8)} USD — ${this.decisions} decisions across ${this.tests} test runs.`,
    );
    if (this.missing)
      console.log(
        `${this.missing} missing/unreadable cost reports; this is a subtotal.`,
      );
    console.log(
      'Includes verification controls and stale-evidence decisions. Attempts without returned usage are excluded.',
    );
  }
}
