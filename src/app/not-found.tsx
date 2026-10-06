import Link from 'next/link';
export default function Page() {
  return (
    <main className="empty">
      <h1>Страница не найдена</h1>
      <Link className="primary" href="/library">
        В библиотеку
      </Link>
    </main>
  );
}
