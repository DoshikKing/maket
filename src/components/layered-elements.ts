import type { ReactElement } from 'react';

/** Edges precede shapes at equal levels, preserving legacy diagrams without explicit layers. */
export function layeredElements(
  document: { nodes: { id: string; layer?: number }[]; edges: { id: string; layer?: number }[] },
  elements: (ReactElement | null)[],
) {
  const layers = new Map(
    [...document.edges, ...document.nodes].map((item) => [item.id, item.layer ?? 0]),
  );
  return elements
    .filter((element): element is ReactElement => element !== null)
    .sort((a, b) => (layers.get(String(a.key)) ?? 0) - (layers.get(String(b.key)) ?? 0));
}
