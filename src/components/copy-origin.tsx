import type { ModelObject } from '@/lib/model';
export function CopyOrigin({ origin }: { origin: ModelObject['copiedFrom'] }) {
  return origin ? (
    <p className="muted small-text copy-origin">
      Скопировано из: <strong>{origin.name}</strong>
      <br />
      <code>{origin.id}</code>
      <br />
      Происхождение копии; изменения оригинала не передаются.
    </p>
  ) : null;
}
