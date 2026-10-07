'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Upload,
  ArrowUpRight,
  Clock,
  Copy,
  Trash2,
  Pencil,
  GitBranch,
  Workflow,
  Layers,
} from 'lucide-react';
import { api, date, readJson } from '@/lib/client';
import { DiagramDocument } from '@/lib/notation';
import {
  portableDiagramSchema,
  projectDocument,
  displayedView,
  type ModelDocument,
} from '@/lib/model';
import { Modal } from './modal';
import { edgeGeometry } from '@/lib/diagram-geometry';
import { NodeShape } from './node-shape';
import {
  contrastColor,
  nodeAppearance,
  nodeLabel,
  edgeAppearance,
  lineDash,
} from '@/lib/appearance';
type Item = {
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
  document: DiagramDocument;
};
type ServerItem = Omit<Item, 'document'> & { document: ModelDocument };
export type NotationItem = {
  id: string;
  name: string;
  builtin: boolean;
  versionId: string | null;
  document: DiagramDocument['notation'];
};
export function LibraryPage() {
  const [items, setItems] = useState<Item[]>([]),
    [notations, setNotations] = useState<NotationItem[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('recent'),
    [create, setCreate] = useState(false),
    [notationIds, setNotationIds] = useState<string[]>(['builtin']),
    [busy, setBusy] = useState(false);
  const router = useRouter(),
    file = useRef<HTMLInputElement>(null);
  async function load() {
    try {
      const [d, n] = await Promise.all([
        api<ServerItem[]>('diagrams'),
        api<NotationItem[]>('notations'),
      ]);
      setItems(
        d.map((item) => ({
          ...item,
          document: displayedView(projectDocument(item.document), item.document.objects),
        })),
      );
      setNotations(n);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const filtered = items
    .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'ru')
        : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  async function operation(id: string, op: 'delete' | 'duplicate' | 'rename') {
    if (op === 'delete' && !confirm('Удалить диаграмму и всю её историю?')) return;
    const name =
      op === 'rename' ? prompt('Новое название', items.find((i) => i.id === id)?.name) : null;
    if (op === 'rename' && !name?.trim()) return;
    setError('');
    try {
      await api(
        `diagrams/${id}${op === 'duplicate' ? '/duplicate' : ''}`,
        op === 'delete' ? 'DELETE' : op === 'rename' ? 'PATCH' : 'POST',
        op === 'rename' ? { name } : op === 'duplicate' ? {} : undefined,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ВАШИ ИДЕИ В ОДНОМ МЕСТЕ</div>
          <h1>
            Библиотека <span className="count">{items.length}</span>
          </h1>
          <p className="muted">Создавайте, исследуйте и связывайте идеи.</p>
        </div>
        <div className="button-row">
          <input
            ref={file}
            type="file"
            accept=".json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setError('');
              try {
                const raw = await readJson(f);
                const document = portableDiagramSchema.parse(raw.document ?? raw);
                const d = await api<Item>('diagrams', 'POST', {
                  name:
                    typeof raw.name === 'string'
                      ? raw.name
                      : f.name.replace(/\.maket\.json$|\.json$/, ''),
                  document,
                });
                router.push(`/diagrams/${d.id}`);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
          <button className="secondary" onClick={() => file.current?.click()}>
            <Upload size={17} />
            Импорт
          </button>
          <button className="primary" onClick={() => setCreate(true)}>
            <Plus size={18} />
            Создать диаграмму
          </button>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <section className="welcome-banner">
        <div>
          <span className="tag">ПРОСТРАНСТВО ДЛЯ БОЛЬШИХ ИДЕЙ</span>
          <h2>Сложное становится понятным</h2>
          <p>Начните с одного элемента. Соедините мысли в целую картину.</p>
          <button className="text-button" onClick={() => setCreate(true)}>
            Создать первую связь <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="banner-visual" aria-hidden="true">
          <div className="mini-node">
            <Workflow size={22} />
          </div>
          <span />
          <div className="mini-node mid">
            <GitBranch size={24} />
          </div>
          <span />
          <div className="mini-node">
            <Layers size={22} />
          </div>
          <i className="visual-dot d1" />
          <i className="visual-dot d2" />
        </div>
      </section>
      {items.length > 0 && (
        <section className="recent">
          <div className="section-title">
            <h2>
              <Clock size={18} />
              Недавние изменения
            </h2>
            <span className="muted">Продолжите с того места, где остановились</span>
          </div>
          <div className="recent-grid">
            {items.slice(0, 3).map((d) => (
              <Link key={d.id} href={`/diagrams/${d.id}`} className="recent-item">
                <span className="file-icon">
                  <Workflow size={20} />
                </span>
                <div>
                  <strong>{d.name}</strong>
                  <small>
                    {date(d.updatedAt)} · версия {d.revision}
                  </small>
                </div>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
        </section>
      )}
      <section>
        <div className="list-toolbar">
          <h2>Все диаграммы</h2>
          <div className="button-row">
            <div className="search">
              <Search size={17} />
              <input
                aria-label="Поиск диаграмм"
                placeholder="Найти диаграмму…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select aria-label="Сортировка" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">Сначала новые</option>
              <option value="name">По названию</option>
            </select>
          </div>
        </div>
        {loading ? (
          <div className="empty">Загружаем библиотеку…</div>
        ) : (
          <div className="diagram-grid">
            {filtered.map((d) => (
              <article className="diagram-card" key={d.id}>
                <Link href={`/diagrams/${d.id}`} className="diagram-preview">
                  <DiagramPreview document={d.document} />
                  <span className="notation-badge">{d.document.notation.name}</span>
                </Link>
                <div className="card-body">
                  <Link className="card-title" href={`/diagrams/${d.id}`}>
                    {d.name}
                  </Link>
                  <small>Изменена {date(d.updatedAt)}</small>
                  <div className="card-bottom">
                    <span>
                      {d.document.nodes.length} элементов · v{d.revision}
                    </span>
                    <div className="card-actions">
                      <button
                        className="icon-button"
                        title="Переименовать"
                        aria-label={`Переименовать ${d.name}`}
                        onClick={() => operation(d.id, 'rename')}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="icon-button"
                        title="Дублировать"
                        aria-label={`Дублировать ${d.name}`}
                        onClick={() => operation(d.id, 'duplicate')}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        className="icon-button danger"
                        title="Удалить"
                        aria-label={`Удалить ${d.name}`}
                        onClick={() => operation(d.id, 'delete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
            {!query && (
              <button className="create-card" onClick={() => setCreate(true)}>
                <span>
                  <Plus size={25} />
                </span>
                <strong>Новая диаграмма</strong>
                <small>Дайте форму новой идее</small>
              </button>
            )}
            {query && !filtered.length && (
              <div className="empty">Ничего не найдено. Попробуйте другое название.</div>
            )}
          </div>
        )}
      </section>
      {create && (
        <Modal title="Новая диаграмма" onClose={() => setCreate(false)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const name = new FormData(e.currentTarget).get('name');
                const d = await api<Item>('diagrams', 'POST', { name, notationIds });
                router.push(`/diagrams/${d.id}`);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Название
              <input
                name="name"
                required
                maxLength={100}
                placeholder="Например, процесс оформления заказа"
                autoFocus
              />
            </label>
            <label>Выберите нотации — можно несколько</label>
            <div className="notation-options">
              {notations.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  className={`notation-option ${notationIds.includes(n.id) ? 'selected' : ''}`}
                  aria-pressed={notationIds.includes(n.id)}
                  onClick={() =>
                    setNotationIds((ids) =>
                      ids.includes(n.id) ? ids.filter((id) => id !== n.id) : [...ids, n.id],
                    )
                  }
                >
                  <ShapesIcon />
                  <div>
                    <strong>{n.name}</strong>
                    <small>
                      {n.builtin ? 'Готовая нотация' : 'Ваша нотация'} ·{' '}
                      {n.document.nodeTypes.length} типов элементов
                    </small>
                  </div>
                  <span className="radio" />
                </button>
              ))}
            </div>
            {error && <div className="error">{error}</div>}
            <button className="primary wide" disabled={busy || !notationIds.length}>
              {busy ? 'Создаём…' : 'Открыть редактор'}
              <ArrowUpRight size={18} />
            </button>
          </form>
        </Modal>
      )}
    </main>
  );
}
function ShapesIcon() {
  return (
    <span className="file-icon">
      <GitBranch size={20} />
    </span>
  );
}
export function DiagramPreview({ document: d }: { document: DiagramDocument }) {
  const geometry = edgeGeometry(d);
  if (!d.nodes.length && !geometry.size)
    return (
      <div className="preview-empty">
        <Workflow size={34} />
        <span>Чистый лист для ваших идей</span>
      </div>
    );

  const appearance = (n: DiagramDocument['nodes'][number]) =>
    nodeAppearance(
      n,
      d.notation.nodeTypes.find((t) => t.id === n.typeId)!,
    );
  const points = [
    ...d.nodes.flatMap((n) => [
      n.position,
      { x: n.position.x + appearance(n).width, y: n.position.y + appearance(n).height },
    ]),
    ...[...geometry.values()].flatMap((g) => [g.source, g.target, g.center]),
  ];
  const minX = Math.min(...points.map((p) => p.x)),
    minY = Math.min(...points.map((p) => p.y)),
    maxX = Math.max(...points.map((p) => p.x)),
    maxY = Math.max(...points.map((p) => p.y));
  return (
    <svg
      className="preview-svg"
      viewBox={`${minX - 30} ${minY - 30} ${maxX - minX + 60} ${maxY - minY + 60}`}
      aria-label="Миниатюра диаграммы"
    >
      {d.edges.map((e) => {
        const g = geometry.get(e.id);
        return g ? (
          <path
            key={e.id}
            d={g.path}
            stroke={
              edgeAppearance(
                d.notation.edgeTypes.find((t) => t.id === e.typeId)!.appearance,
                e.appearance,
              ).color
            }
            strokeWidth={
              edgeAppearance(
                d.notation.edgeTypes.find((t) => t.id === e.typeId)!.appearance,
                e.appearance,
              ).width
            }
            strokeDasharray={lineDash(
              edgeAppearance(
                d.notation.edgeTypes.find((t) => t.id === e.typeId)!.appearance,
                e.appearance,
              ),
            )}
          />
        ) : null;
      })}
      {[...d.nodes]
        .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))
        .map((n) => {
          const t = d.notation.nodeTypes.find((t) => t.id === n.typeId);
          if (!t) return null;
          const a = nodeAppearance(n, t),
            w = a.width,
            h = a.height;
          return (
            <g key={n.id} transform={`translate(${n.position.x},${n.position.y})`}>
              <NodeShape appearance={a} shapes={d.notation.shapes} className="preview-shape" />
              <text
                x={w / 2}
                y={h / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={a.fontSize ?? 12}
                transform={`rotate(${a.textRotation ?? 0},${w / 2},${h / 2})`}
                fill={a.shape === 'text' ? 'var(--text)' : contrastColor(a.fill)}
              >
                {nodeLabel(n, t).slice(0, 24)}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
