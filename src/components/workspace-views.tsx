import Link from 'next/link';
import { FileText, Workflow } from 'lucide-react';
export function WorkspaceViews({
  active,
  parentId,
}: {
  active: 'model' | 'diagrams';
  parentId?: string | null;
}) {
  const parent = parentId ? `&parent=${encodeURIComponent(parentId)}` : '';
  return (
    <nav className="workspace-views" aria-label="Обозреватели рабочей области">
      <Link
        href={`/solutions?view=model${parent}`}
        aria-current={active === 'model' ? 'page' : undefined}
      >
        <Workflow size={16} />
        Модель
      </Link>
      <Link
        href={`/solutions?view=diagrams${parent}`}
        aria-current={active === 'diagrams' ? 'page' : undefined}
      >
        <FileText size={16} />
        Диаграммы
      </Link>
    </nav>
  );
}
