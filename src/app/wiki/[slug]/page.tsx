import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { wikiArticle, wikiArticles, wikiGroups } from '@/lib/wiki';
export const dynamicParams = false;
export function generateStaticParams() {
  return wikiArticles.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const article = wikiArticle((await params).slug);
  return article ? { title: article.title, description: article.summary } : {};
}
export default async function WikiArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = wikiArticle((await params).slug);
  if (!article) notFound();
  const ordered = wikiGroups.flatMap((group) =>
    wikiArticles.filter((item) => item.group === group),
  );
  const index = ordered.indexOf(article);
  const previous = ordered[index - 1],
    next = ordered[index + 1];
  return (
    <div className="wiki-article-layout">
      <article className="wiki-article">
        <nav className="wiki-breadcrumb" aria-label="Путь к статье">
          <Link href="/wiki">Вики</Link>
          <span aria-hidden="true">/</span>
          <span>{article.group}</span>
        </nav>
        <h1>{article.title}</h1>
        <p className="wiki-lead">{article.summary}</p>
        {article.sections.map((section) => (
          <section id={section.id} key={section.id} className="wiki-section">
            <h2>
              <a href={`#${section.id}`}>
                {section.title}
                <span className="wiki-anchor" aria-hidden="true">
                  #
                </span>
              </a>
            </h2>
            {section.paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
            {section.steps && (
              <ol>
                {section.steps.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ol>
            )}
            {section.items && (
              <ul>
                {section.items.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            )}
            {section.table && (
              <div
                className="wiki-table-scroll"
                tabIndex={0}
                role="region"
                aria-label={section.title}
              >
                <table>
                  <thead>
                    <tr>
                      {section.table.headers.map((header) => (
                        <th scope="col" key={header}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.table.rows.map((row) => (
                      <tr key={row[0]}>
                        {row.map((cell, i) => (
                          <td key={i}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {section.code && (
              <pre className="wiki-code" tabIndex={0} aria-label={`Пример: ${section.title}`}>
                <code>{section.code}</code>
              </pre>
            )}
            {section.note && (
              <aside className="wiki-note">
                <strong>Обратите внимание</strong>
                <p>{section.note}</p>
              </aside>
            )}
          </section>
        ))}
        <section className="wiki-related" aria-label="Связанные статьи">
          <h2>Читайте также</h2>
          {article.related.map((slug) => {
            const related = wikiArticle(slug)!;
            return (
              <Link href={`/wiki/${slug}`} key={slug}>
                {related.title}
                <ArrowRight size={16} />
              </Link>
            );
          })}
        </section>
        <nav className="wiki-pagination" aria-label="Переход между статьями">
          {previous ? (
            <Link href={`/wiki/${previous.slug}`}>
              <ArrowLeft size={16} />
              <span>
                <small>Предыдущая статья</small>
                {previous.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/wiki/${next.slug}`}>
              <span>
                <small>Следующая статья</small>
                {next.title}
              </span>
              <ArrowRight size={16} />
            </Link>
          )}
        </nav>
      </article>
      <aside className="wiki-toc">
        <nav aria-label="В этой статье">
          <p>В ЭТОЙ СТАТЬЕ</p>
          {article.sections.map((section) => (
            <a href={`#${section.id}`} key={section.id}>
              {section.title}
            </a>
          ))}
        </nav>
      </aside>
    </div>
  );
}
