import { createElement } from 'react';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';
import { DiagramSvg, diagramBounds } from '@/components/diagram-svg';
import { displayedView, projectDocument, type ModelDocument } from './model';
import { drawioXml } from './drawio-export';
import { importDrawio } from './drawio-import';
import { reject } from './model-errors';
const require = createRequire(import.meta.url);
// Use the Node renderer, outside React Server Component conditions. No HTML is accepted as markup.
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');
export type DiagramFileFormat = 'json' | 'drawio' | 'png' | 'jpeg' | 'pdf';
export async function exportDiagramFile(
  name: string,
  document: ModelDocument,
  format: DiagramFileFormat,
) {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || 'diagram';
  const result = (data: Buffer, mimeType: string) => {
    if (data.length > 8_000_000) reject(413, 'Экспорт превышает 8 МБ. Уменьшите диаграмму');
    return { filename: `${safe}.${format === 'json' ? 'maket.json' : format}`, mimeType, data };
  };
  if (format === 'json')
    return result(Buffer.from(JSON.stringify({ name, document }, null, 2)), 'application/json');
  const view = projectDocument(document);
  if (format === 'drawio')
    return result(Buffer.from(await drawioXml(name, view, document.objects)), 'application/xml');
  const bounds = diagramBounds({ ...view, ...displayedView(view, document.objects) });
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    reject(400, 'Недопустимые размеры диаграммы');
  const scale = Math.min(
    2,
    8192 / Math.max(bounds.width, bounds.height),
    Math.sqrt(16_000_000 / (bounds.width * bounds.height)),
  );
  const width = Math.max(1, Math.ceil(bounds.width * scale)),
    height = Math.max(1, Math.ceil(bounds.height * scale));
  const svg = renderToStaticMarkup(
    createElement(DiagramSvg, { document: view, objects: document.objects, bounds, width, height }),
  );
  const raster = sharp(Buffer.from(svg), { limitInputPixels: 16_020_000 }).flatten({
    background: '#ffffff',
  });
  if (format === 'png') return result(await raster.png().toBuffer(), 'image/png');
  const jpeg = await raster.jpeg({ quality: 95 }).toBuffer();
  if (format === 'jpeg') return result(jpeg, 'image/jpeg');
  const { jsPDF } = await import('jspdf');
  const pageWidth = 277,
    pageHeight = Math.max(1, (pageWidth * height) / width),
    factor = Math.min(1, 400 / pageHeight);
  const pdf = new jsPDF({
    orientation: width >= height ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [pageWidth * factor + 20, pageHeight * factor + 20],
  });
  pdf.addImage(new Uint8Array(jpeg), 'JPEG', 10, 10, pageWidth * factor, pageHeight * factor);
  return result(Buffer.from(pdf.output('arraybuffer')), 'application/pdf');
}
export async function parseDrawioOnServer(filename: string, content: Uint8Array<ArrayBuffer>) {
  // Isolated DOM per import: scripts and resource loading stay disabled, with no global mutations.
  const realm = new JSDOM('<!doctype html><html><body></body></html>');
  try {
    return await importDrawio(new File([content], filename, { type: 'application/xml' }), {
      document: realm.window.document,
      parseXml: (value) => new realm.window.DOMParser().parseFromString(value, 'application/xml'),
      serialize: (value) => new realm.window.XMLSerializer().serializeToString(value),
    });
  } finally {
    realm.window.close();
  }
}
