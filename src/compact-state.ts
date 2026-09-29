/** Lossless factoring of repeated page text; no candidates or evidence are removed. */
export function compactState(state: unknown): {
  state: unknown;
  compacted: boolean;
} {
  // Keep the established prompt representation on ordinary pages. References
  // can change model judgments, so use them only for large snapshots.
  if (JSON.stringify(state)?.length < 120_000)
    return { state, compacted: false };
  if (
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    'sharedText' in state
  )
    return { state, compacted: false };
  const counts = new Map<string, number>();
  function count(value: unknown): void {
    if (typeof value === 'string' && value.length > 80)
      counts.set(value, (counts.get(value) ?? 0) + 1);
    else if (Array.isArray(value)) value.forEach(count);
    else if (value && typeof value === 'object')
      Object.values(value).forEach(count);
  }
  count(state);
  const ids = new Map(
    [...counts].filter(([, n]) => n > 1).map(([text], i) => [text, `t${i}`]),
  );
  if (!ids.size) return { state, compacted: false };
  function replace(value: unknown): unknown {
    if (typeof value === 'string' && ids.has(value))
      return { textRef: ids.get(value) };
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, replace(v)]),
      );
    return value;
  }
  return {
    compacted: true,
    state: {
      ...(replace(state) as Record<string, unknown>),
      sharedText: Object.fromEntries([...ids].map(([text, id]) => [id, text])),
    },
  };
}
