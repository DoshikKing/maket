import Link from 'next/link';
import { ArrowRight, BookOpen, Compass, Layers, Users } from 'lucide-react';
import { wikiArticles, wikiGroups } from '@/lib/wiki';
const highlights = [
  {
    slug: 'getting-started',
    icon: Compass,
    label: 'Начать работу',
    text: 'Создайте первую диаграмму и разберитесь с моделью.',
  },
  {
    slug: 'object-model',
    icon: Layers,
    label: 'Понять устройство',
    text: 'Объекты, связи и представления в общей модели.',
  },
  {
    slug: 'collaboration',
    icon: Users,
    label: 'Работать вместе',
    text: 'Участники, роли и одновременное редактирование.',
  },
];
export default function WikiPage() {
  return (
    <>
      <div className="wiki-intro">
        <p className="eyebrow">СПРАВОЧНИК ПРОДУКТА</p>
        <h1>От идеи до общей модели.</h1>
        <p className="wiki-lead">
          Всё о работе в maket: создавайте решения, связывайте объекты и рассматривайте систему с
          разных ракурсов.
        </p>
        <div className="wiki-intro-meta">
          <BookOpen size={16} /> {wikiArticles.length} статей · Доступно без входа
        </div>
      </div>
      <div className="wiki-highlights">
        {highlights.map(({ slug, icon: Icon, label, text }) => (
          <Link className="wiki-highlight" key={slug} href={`/wiki/${slug}`}>
            <Icon size={22} aria-hidden="true" />
            <h2>{label}</h2>
            <p>{text}</p>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        ))}
      </div>
      <div className="wiki-catalog">
        {wikiGroups.map((group) => (
          <section key={group} aria-label={group}>
            <h2>{group}</h2>
            {wikiArticles
              .filter((article) => article.group === group)
              .map((article) => (
                <Link
                  className="wiki-catalog-item"
                  key={article.slug}
                  href={`/wiki/${article.slug}`}
                >
                  <div>
                    <h3>{article.title}</h3>
                    <p>{article.summary}</p>
                  </div>
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              ))}
          </section>
        ))}
      </div>
    </>
  );
}
