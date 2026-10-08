'use client';
import { useRef, useState } from 'react';
import { Modal } from './modal';
import { DiagramSvg } from './diagram-svg';
import { exportImage, type ExportFormat } from '@/lib/image-export';
import { type ModelObject, type ViewDocument } from '@/lib/model';
import { download } from '@/lib/client';
export function ExportDialog({
  name,
  document,
  objects,
  json,
  onClose,
}: {
  name: string;
  document: ViewDocument;
  objects: ModelObject[];
  json?: unknown;
  onClose: () => void;
}) {
  const ref = useRef<SVGSVGElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title="Экспорт диаграммы" onClose={onClose}>
      <p className="muted">
        Экспортируется вся диаграмма на белом фоне, включая подписи и атрибуты.
      </p>
      <div className="export-preview">
        <DiagramSvg document={document} objects={objects} svgRef={ref} />
      </div>
      <div className="button-row">
        {(['png', 'jpeg', 'pdf'] as const).map((format: ExportFormat) => (
          <button
            key={format}
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await exportImage(ref.current!, name, format);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {format.toUpperCase()}
          </button>
        ))}
        {json !== undefined && (
          <button className="secondary" onClick={() => download(`${name}.maket.json`, json)}>
            JSON
          </button>
        )}
      </div>
      {busy && <p role="status">Создаём файл…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
