import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { announcements } from '../content/announcements';

interface Props { onClose: () => void }

export default function AnnouncementCenter({ onClose }: Props) {
  const [selectedId, setSelectedId] = useState(announcements[0]?.id);
  const selected = announcements.find((announcement) => announcement.id === selectedId) ?? announcements[0];

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div className="announcement-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="announcement-dialog" role="dialog" aria-modal="true" aria-label="项目公告">
        <header>
          <div><p className="eyebrow">NEWS & UPDATES</p><h2>项目公告</h2></div>
          <button type="button" aria-label="关闭公告" onClick={onClose}>×</button>
        </header>
        <aside aria-label="公告列表">
          {announcements.map((announcement) => <button key={announcement.id} type="button" className={announcement.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(announcement.id)}>
            <span>{announcement.pinned && '置顶 · '}{announcement.publishedAt}</span>
            <strong>{announcement.title}</strong>
            <small>{announcement.summary}</small>
          </button>)}
        </aside>
        {selected && <article className="announcement-content">
          <div className="announcement-meta">
            <time dateTime={selected.publishedAt}>{selected.publishedAt}</time>
            {selected.version && <span>{selected.version}</span>}
            {selected.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <h2>{selected.title}</h2>
          <p className="announcement-summary">{selected.summary}</p>
          {selected.sections.map((section) => <section key={section.heading}>
            <h3>{section.heading}</h3>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
          </section>)}
        </article>}
      </section>
    </div>,
    document.body,
  );
}
