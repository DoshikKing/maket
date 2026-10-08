'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { projectDocument, relationEntity, type ModelDocument } from '@/lib/model';
import { nodeAppearance } from '@/lib/appearance';
import { edgeGeometry } from '@/lib/diagram-geometry';
import { DiagramSvg, diagramBounds, type Bounds } from './diagram-svg';
import { ExportDialog } from './export-dialog';
type Shared = { name: string; revision: number; document: ModelDocument };
export function PublicViewer({ token }: { token: string }) {
  const [shared, setShared] = useState<Shared | null>(null),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(''),
    [box, setBox] = useState<Bounds | null>(null),
    [tree, setTree] = useState(true),
    [exporting, setExporting] = useState(false),
    [closed, setClosed] = useState(new Set<string>()),
    [notice, setNotice] = useState('');
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{ x: number; y: number; box: Bounds } | null>(null);
  const view = shared ? projectDocument(shared.document) : null;
  const focus = useCallback((data: Shared, id: string, updateUrl = true) => {
    const d = projectDocument(data.document),
      n = d.nodes.find((n) => n.id === id),
      e = d.edges.find((e) => e.id === id);
    if (!n && !e) {
      setNotice('Элемент отсутствует в этой диаграмме');
      return;
    }
    setNotice('');
    setSelected(id);
    if (n) {
      const a = nodeAppearance(
        n,
        d.notation.nodeTypes.find((t) => t.id === n.typeId)!,
      );
      setBox({
        x: n.position.x - 100,
        y: n.position.y - 100,
        width: a.width + 200,
        height: a.height + 200,
      });
    } else {
      const g = edgeGeometry(d).get(id);
      if (g) setBox({ x: g.center.x - 200, y: g.center.y - 120, width: 400, height: 240 });
    }
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.delete('object');
      url.searchParams.set('element', id);
      history.replaceState(null, '', url);
    }
  }, []);
  useEffect(() => {
    let active = true,
      initialized = false;
    const load = async () => {
      try {
        const result = await api<Shared>(`public/${encodeURIComponent(token)}`);
        if (!active) return;
        setShared(result);
        setError('');
        if (!initialized) {
          initialized = true;
          const params = new URL(location.href).searchParams;
          const element =
            params.get('element') ??
            result.document.nodes.find((n) => n.objectId === params.get('object'))?.id;
          if (element) focus(result, element, false);
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          setShared(null);
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token, focus]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setBox((current) => {
        const b = current ?? diagramBounds(projectDocument(shared!.document));
        const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
        if (b.width * factor < 30 || b.width * factor > 1000000) return b;
        return {
          x: b.x + (b.width * (1 - factor)) / 2,
          y: b.y + (b.height * (1 - factor)) / 2,
          width: b.width * factor,
          height: b.height * factor,
        };
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [shared]);
  if (error)
    return (
      <main className="public-error">
        <h1>Диаграмма недоступна</h1>
        <p role="alert">{error}</p>
      </main>
    );
  if (!shared || !view)
    return (
      <main className="public-error">
        <p role="status">Загружаем диаграмму…</p>
      </main>
    );
  const entities = [
      ...shared.document.objects,
      ...(shared.document.relations ?? []).map(relationEntity),
    ],
    relations = shared.document.relations ?? [];
  const displayed = box ?? diagramBounds(view);
  const chooseEntity = (id: string) => {
    const representation =
      view.nodes.find((n) => n.objectId === id) ?? view.edges.find((e) => e.relationId === id);
    if (representation) focus(shared, representation.id);
    else setNotice('У объекта нет представления на этой диаграмме');
  };
  const diagramView = view;
  function branch(parent: string | null, seen = new Set<string>()): React.ReactNode {
    return entities
      .filter((e) => e.parentId === parent && !seen.has(e.id))
      .map((e) => (
        <li key={e.id}>
          <div className="viewer-tree-row">
            <button
              aria-label={`${closed.has(e.id) ? 'Развернуть' : 'Свернуть'} ${e.name}`}
              onClick={() =>
                setClosed((prev) => {
                  const next = new Set(prev);
                  next.has(e.id) ? next.delete(e.id) : next.add(e.id);
                  return next;
                })
              }
            >
              {closed.has(e.id) ? '▸' : '▾'}
            </button>
            <button onClick={() => chooseEntity(e.id)}>
              {e.name}{' '}
              <small>
                (
                {diagramView.nodes.filter((n) => n.objectId === e.id).length +
                  diagramView.edges.filter((r) => r.relationId === e.id).length}
                )
              </small>
            </button>
          </div>
          {!closed.has(e.id) && (
            <>
              <ul>{branch(e.id, new Set([...seen, e.id]))}</ul>
              {relations.some((r) => r.sourceId === e.id || r.targetId === e.id) && (
                <details className="viewer-relations">
                  <summary>Связи</summary>
                  <ul>
                    {relations
                      .filter((r) => r.sourceId === e.id || r.targetId === e.id)
                      .map((r) => (
                        <li key={r.id}>
                          <button onClick={() => chooseEntity(r.id)}>{r.name}</button>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </li>
      ));
  }
  function zoom(factor: number) {
    setBox({
      x: displayed.x + (displayed.width * (1 - factor)) / 2,
      y: displayed.y + (displayed.height * (1 - factor)) / 2,
      width: displayed.width * factor,
      height: displayed.height * factor,
    });
  }
  return (
    <main className="public-viewer">
      <header className="viewer-toolbar">
        <div>
          <strong>{shared.name}</strong>
          <small>Просмотр диаграммы</small>
        </div>
        <div className="button-row">
          <button className="secondary small" aria-pressed={tree} onClick={() => setTree(!tree)}>
            Дерево объектов
          </button>
          <button className="secondary small" onClick={() => setExporting(true)}>
            Экспорт
          </button>
          <button
            className="secondary small"
            disabled={!selected}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(location.href);
                setNotice('Ссылка на элемент скопирована');
              } catch {
                setNotice('Скопируйте ссылку из адресной строки');
              }
            }}
          >
            Ссылка на элемент
          </button>
        </div>
      </header>
      {notice && (
        <div role="status" className="viewer-notice">
          {notice}
        </div>
      )}
      <div className="viewer-body">
        {tree && (
          <aside className="viewer-tree" aria-label="Дерево объектов">
            <h2>Объекты диаграммы</h2>
            <ul>{branch(null)}</ul>
          </aside>
        )}
        <section className="viewer-canvas" aria-label="Канвас просмотра">
          <DiagramSvg
            document={view}
            objects={shared.document.objects}
            svgRef={svg}
            selectedId={selected}
            onSelect={(id) => {
              if (!drag.current) focus(shared, id);
            }}
            bounds={displayed}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const target = event.target as Element;
              if (target.closest('[data-representation-id]')) return;
              drag.current = { x: event.clientX, y: event.clientY, box: displayed };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start) return;
              const matrix = event.currentTarget.getScreenCTM();
              if (!matrix) return;
              setBox({
                ...start.box,
                x: start.box.x - (event.clientX - start.x) / matrix.a,
                y: start.box.y - (event.clientY - start.y) / matrix.d,
              });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          />
          <div className="viewer-controls">
            <button aria-label="Приблизить" onClick={() => zoom(0.8)}>
              +
            </button>
            <button aria-label="Отдалить" onClick={() => zoom(1.25)}>
              −
            </button>
            <button onClick={() => setBox(null)}>Вся диаграмма</button>
          </div>
        </section>
      </div>
      {exporting && (
        <ExportDialog
          name={shared.name}
          document={view}
          objects={shared.document.objects}
          onClose={() => setExporting(false)}
        />
      )}
    </main>
  );
}
