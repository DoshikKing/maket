'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { api, readJson } from '@/lib/client';
import { importDrawio } from '@/lib/drawio-import';
import { portableDiagramSchema } from '@/lib/model';
import { Modal } from './modal';
export function ImportDiagramButton({
  beforeImport,
  onImported,
  compact = false,
}: {
  compact?: boolean;
  beforeImport?: () => Promise<boolean>;
  onImported?: () => void;
}) {
  const file = useRef<HTMLInputElement>(null),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [importWarnings, setImportWarnings] = useState<string[]>([]),
    [importFolderId, setImportFolderId] = useState<string>();
  return (
    <>
      <input
        ref={file}
        type="file"
        accept=".json,.drawio,.xml"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setError('');
          setImportWarnings([]);
          setImportFolderId(undefined);
          setBusy(true);
          try {
            if (beforeImport && !(await beforeImport())) return;
            if (/\.(drawio|xml)$/i.test(f.name)) {
              const imported = await importDrawio(f);
              const result = await api<{ folder: { id: string }; diagrams: { id: string }[] }>(
                'diagram-imports',
                'POST',
                {
                  folderName: imported.folderName,
                  pages: imported.pages,
                },
              );
              window.dispatchEvent(new Event('maket:workspace-changed'));
              if (imported.warnings.length) {
                setImportWarnings(imported.warnings);
                setImportFolderId(result.folder.id);
                onImported?.();
              } else router.push(`/solutions?parent=${result.folder.id}`);
              return;
            }
            const raw = await readJson(f);
            const document = portableDiagramSchema.parse(raw.document ?? raw);
            const d = await api<{ id: string }>('diagrams', 'POST', {
              name:
                typeof raw.name === 'string'
                  ? raw.name
                  : f.name.replace(/\.maket\.json$|\.json$/, ''),
              document,
            });
            window.dispatchEvent(new Event('maket:workspace-changed'));
            router.push(`/solutions?diagram=${d.id}`);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        className={`secondary${compact ? ' small' : ''}`}
        disabled={busy}
        onClick={() => file.current?.click()}
      >
        <Upload size={compact ? 16 : 17} />
        Импорт
      </button>
      {importWarnings.length > 0 && (
        <Modal title="Импорт завершён" onClose={() => setImportWarnings([])}>
          <div>
            <ul>
              {importWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            {importFolderId && (
              <Link className="text-link" href={`/solutions?parent=${importFolderId}`}>
                Открыть папку импорта
              </Link>
            )}
          </div>
        </Modal>
      )}
      {error && (
        <Modal title="Не удалось импортировать диаграмму" onClose={() => setError('')}>
          <div className="error" role="alert">
            {error}
          </div>
        </Modal>
      )}
    </>
  );
}
