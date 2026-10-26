// Bound recursion before schema validation and workspace target collection on untrusted JSON.
export function hasSafeJsonDepth(value: unknown, maxDepth = 32) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (!value || typeof value !== 'object') continue;
    if (depth > maxDepth) return false;
    for (const child of Object.values(value))
      if (child && typeof child === 'object') pending.push({ value: child, depth: depth + 1 });
  }
  return true;
}
