import type { NodeAppearance } from './appearance';

/** Label regions follow draw.io's independent outer position, inner alignment and padding. */
export function nodeTextBox(a: NodeAppearance) {
  const p = a.textPadding ?? { top: 8, right: 12, bottom: 8, left: 12 };
  const vertical = Math.abs(a.textRotation ?? 0) === 90;
  const width = Math.max(1, (vertical ? a.height : a.width) - p.left - p.right);
  const height = Math.max(1, (vertical ? a.width : a.height) - p.top - p.bottom);
  const align = a.textVerticalAlign ?? 'middle';
  const anchor = align === 'top' ? 0 : align === 'bottom' ? 1 : 0.5;
  return {
    x:
      (a.textPosition?.horizontal === 'left'
        ? -a.width
        : a.textPosition?.horizontal === 'right'
          ? a.width
          : 0) +
      a.width / 2 +
      (p.left - p.right) / 2 +
      (a.textOffset?.x ?? 0),
    y:
      (a.textPosition?.vertical === 'top'
        ? -a.height
        : a.textPosition?.vertical === 'bottom'
          ? a.height
          : 0) +
      p.top +
      (a.height - p.top - p.bottom) * anchor +
      (a.textOffset?.y ?? 0),
    width: a.shape === 'diamond' ? a.width * 0.65 : width,
    height: a.shape === 'diamond' ? a.height * 0.65 : height,
    anchor,
  };
}
const wrap = (text: string, columns: number) =>
  text
    .split('\n')
    .flatMap((row) => row.match(new RegExp(`.{1,${Math.max(1, columns)}}`, 'gu')) ?? ['']);
export function nodeTextMetrics(a: NodeAppearance, title: string, attributes: string[] = []) {
  const box = nodeTextBox(a),
    font = a.fontSize ?? 12,
    smallFont = Math.max(8, font - 2);
  const lines = wrap(title, Math.floor(box.width / (font * 0.6)));
  const attrs = attributes.flatMap((row) => wrap(row, Math.floor(box.width / (smallFont * 0.6))));
  const height = Math.min(
    box.height,
    lines.length * font * 1.4 + (attrs.length ? 10 + attrs.length * smallFont * 1.4 : 0),
  );
  return {
    ...box,
    font,
    smallFont,
    lines,
    attrs,
    contentHeight: height,
    centerY: box.y + (0.5 - box.anchor) * height,
  };
}
export function nodeTextBounds(a: NodeAppearance, title: string, attributes: string[] = []) {
  const m = nodeTextMetrics(a, title, attributes),
    angle = ((a.textRotation ?? 0) * Math.PI) / 180;
  return [-1, 1].flatMap((x) =>
    [-1, 1].map((y) => ({
      x:
        m.x + ((x * m.width) / 2) * Math.cos(angle) - ((y * m.contentHeight) / 2) * Math.sin(angle),
      y:
        m.centerY +
        ((x * m.width) / 2) * Math.sin(angle) +
        ((y * m.contentHeight) / 2) * Math.cos(angle),
    })),
  );
}
