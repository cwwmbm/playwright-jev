import { randomUUID } from 'node:crypto';
import type { Locator } from 'playwright-core';
import type { Candidate, CandidateKind } from './types';

export const MARKER = 'data-playwright-jev';
export interface SnapshotEntry {
  candidate: Candidate;
  token: string;
}

/** Deliberately bounded DOM representation; no field values or HTML are sent. */
export async function snapshot(
  root: Locator,
  kind: CandidateKind,
  self = false,
): Promise<SnapshotEntry[]> {
  return (self ? root : root.locator('*')).evaluateAll(
    (nodes, args) => {
      const registryHost = window as unknown as {
        __playwrightJevIds?: WeakMap<Element, string>;
      };
      const registry = (registryHost.__playwrightJevIds ??= new WeakMap<
        Element,
        string
      >());
      const clean = (text: string | null) =>
        (text ?? '').replace(/\s+/g, ' ').trim();
      const textOf = (el: Element) => {
        const clone = el.cloneNode(true) as Element;
        clone
          .querySelectorAll(
            'input,textarea,select,script,style,[contenteditable]',
          )
          .forEach((n) => n.remove());
        if (el.matches('input,textarea,select,[contenteditable]')) return '';
        clone.querySelectorAll('br').forEach((n) => n.replaceWith(' '));
        clone
          .querySelectorAll('div,p,li,h1,h2,h3,h4,h5,h6,section,article')
          .forEach((n) => {
            n.prepend(' ');
            n.append(' ');
          });
        return clean(clone.textContent);
      };
      const visible = (el: Element) => {
        const style = getComputedStyle(el);
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          el.getClientRects().length > 0 &&
          !el.closest('[hidden],[aria-hidden="true"]')
        );
      };
      const selectors: Record<string, string> = {
        select: 'select',
        form: 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=image]):not([type=range]):not([type=color]):not([type=radio]),textarea,select,[contenteditable=true]',
        click:
          'button,a,input[type=button],input[type=submit],[role=button],[role=link],[role=menuitem],[role=tab],[onclick]',
        fill: 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true],[role=textbox]',
        check:
          'input[type=checkbox],input[type=radio],[role=checkbox],[role=switch]',
        container:
          'div,section,article,li,ul,ol,main,form,fieldset,nav,aside,header,footer,[role=region],[role=listitem],[role=dialog]',
        text: '*',
      };
      const result: { candidate: Candidate; token: string }[] = [];
      for (const el of nodes) {
        if (!el.matches(selectors[args.kind]!) || !visible(el)) continue;
        if (
          el.matches(':disabled,[aria-disabled=true],[readonly]') &&
          ['click', 'fill', 'check', 'form', 'select'].includes(args.kind)
        )
          continue;
        const text = textOf(el);
        if (
          args.kind === 'text' &&
          (!text ||
            (!Array.from(el.childNodes).some(
              (node) =>
                node.nodeType === Node.TEXT_NODE && clean(node.textContent),
            ) &&
              !el.matches('p,h1,h2,h3,h4,h5,h6,label,output')) ||
            (el.children.length > 0 &&
              Array.from(el.children).some((child) => textOf(child) === text)))
        )
          continue;
        if (args.kind === 'container' && (!text || !el.children.length))
          continue;
        const labels =
          'labels' in el
            ? Array.from((el as HTMLInputElement).labels ?? [])
                .map(textOf)
                .join(' ')
            : '';
        const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
          .split(/\s+/)
          .map((id) => {
            const label = el.ownerDocument.getElementById(id);
            return label ? textOf(label) : '';
          })
          .join(' ')
          .trim();
        const attributes: Record<string, string> = {};
        for (const key of [
          'id',
          'class',
          'name',
          'type',
          'placeholder',
          'title',
          'alt',
          'data-test',
          'data-testid',
          'aria-checked',
        ]) {
          const value = el.getAttribute(key);
          if (value) attributes[key] = value.slice(0, 180);
        }
        const implicit = el.matches(
          'button,input[type=submit],input[type=button]',
        )
          ? 'button'
          : el.matches('a')
            ? 'link'
            : el.matches('input[type=checkbox]')
              ? 'checkbox'
              : el.matches('input,textarea')
                ? 'textbox'
                : '';
        const buttonLabel = el.matches('input[type=submit],input[type=button]')
          ? el.getAttribute('value')
          : '';
        const name = clean(
          labelledBy ||
            el.getAttribute('aria-label') ||
            labels ||
            el.getAttribute('alt') ||
            buttonLabel ||
            el.getAttribute('placeholder') ||
            el.getAttribute('title') ||
            (args.kind === 'container'
              ? Array.from(el.children)
                  .filter((child) =>
                    child.matches('h1,h2,h3,h4,h5,h6,[role=heading]'),
                  )
                  .map(textOf)
                  .join(' | ')
              : '') ||
            text,
        );
        let token = registry.get(el);
        if (!token) {
          token = `${args.prefix}-${result.length}`;
          registry.set(el, token);
        }
        el.setAttribute(args.marker, token);
        const ancestors: { tag: string; text: string }[] = [];
        let ancestor = el.parentElement;
        for (
          let depth = 0;
          ancestor && depth < 3;
          depth++, ancestor = ancestor.parentElement
        ) {
          ancestors.push({
            tag: ancestor.tagName.toLowerCase(),
            text: textOf(ancestor).slice(0, 1200),
          });
        }
        result.push({
          token,
          candidate: {
            id: `e${result.length}`,
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || implicit,
            name: name.slice(0, 300),
            text: text.slice(0, 800),
            context: el.parentElement
              ? textOf(el.parentElement).slice(0, 1000)
              : '',
            attributes,
            ancestors,
            ...(el instanceof HTMLSelectElement
              ? {
                  multiple: el.multiple,
                  options: Array.from(el.options).map((option, index) => ({
                    index,
                    label: option.label,
                    value: option.value,
                    disabled:
                      option.disabled ||
                      option.parentElement?.matches('optgroup:disabled') ===
                        true,
                  })),
                }
              : {}),
            structure: {
              ...(args.kind === 'container'
                ? {
                    directHeadings: Array.from(el.children)
                      .filter((child) =>
                        child.matches('h1,h2,h3,h4,h5,h6,[role=heading]'),
                      )
                      .map((child) => textOf(child).slice(0, 150)),
                    descendantHeadings: Array.from(
                      el.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]'),
                    )
                      .slice(0, 30)
                      .map((child) => textOf(child).slice(0, 150)),
                  }
                : {}),
              childTags: Array.from(el.children)
                .map((child) => child.tagName.toLowerCase())
                .slice(0, 20),
              similarSiblings: el.parentElement
                ? Array.from(el.parentElement.children).filter(
                    (sibling) =>
                      sibling.tagName === el.tagName &&
                      sibling.getAttribute('class') ===
                        el.getAttribute('class'),
                  ).length
                : 1,
              images: Array.from(el.querySelectorAll('img'))
                .slice(0, 10)
                .map((img) => img.alt),
            },
          },
        });
      }
      return result;
    },
    { kind, marker: MARKER, prefix: randomUUID() },
  );
}

export function fingerprint(
  entry: SnapshotEntry,
  includeContext = true,
): string {
  const { id: _id, ...description } = entry.candidate;
  if (!includeContext) {
    const {
      context: _context,
      ancestors: _ancestors,
      ...ownDescription
    } = description;
    return JSON.stringify(ownDescription);
  }
  return JSON.stringify(description);
}
