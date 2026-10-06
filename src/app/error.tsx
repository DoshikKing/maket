'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="empty">
      <h1>Не удалось открыть страницу</h1>
      <p>Проверьте доступность сервера и базы данных.</p>
      <button className="primary" onClick={reset}>
        Попробовать снова
      </button>
    </main>
  );
}
