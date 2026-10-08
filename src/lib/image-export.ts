export type ExportFormat = 'png' | 'jpeg' | 'pdf';
export async function exportImage(svg: SVGSVGElement, name: string, format: ExportFormat) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const content = svg.querySelector<SVGGElement>('[data-diagram-content]');
  const box = content?.getBBox();
  const bounds =
    box && (box.width || box.height)
      ? { x: box.x - 50, y: box.y - 50, width: box.width + 100, height: box.height + 100 }
      : svg.viewBox.baseVal;
  // Bound raster memory while retaining aspect ratio for large diagrams.
  const scale = Math.min(
    2,
    8192 / Math.max(bounds.width, bounds.height),
    Math.sqrt(16_000_000 / (bounds.width * bounds.height)),
  );
  const width = Math.max(1, Math.ceil(bounds.width * scale)),
    height = Math.max(1, Math.ceil(bounds.height * scale));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], {
      type: 'image/svg+xml;charset=utf-8',
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не поддерживает экспорт изображения');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const filename = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || 'diagram';
    if (format === 'pdf') {
      const { jsPDF } = await import('jspdf');
      const pageWidth = 277,
        pageHeight = Math.max(1, (pageWidth * height) / width);
      const factor = Math.min(1, 400 / pageHeight);
      const pdf = new jsPDF({
        orientation: width >= height ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageWidth * factor + 20, pageHeight * factor + 20],
      });
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.95),
        'JPEG',
        10,
        10,
        pageWidth * factor,
        pageHeight * factor,
      );
      pdf.save(`${filename}.pdf`);
      return;
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Не удалось создать изображение'))),
        `image/${format}`,
        0.95,
      ),
    );
    const fileUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = fileUrl;
      a.download = `${filename}.${format}`;
      a.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
