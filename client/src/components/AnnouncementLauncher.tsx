import { lazy, Suspense, useState } from 'react';
import { announcements, unreadAnnouncementCount } from '../content/announcements';

const AnnouncementCenter = lazy(() => import('./AnnouncementCenter'));
const READ_CURSOR_KEY = 'energy-duel-announcement-read-cursor';

interface Props {
  compact?: boolean;
}

export default function AnnouncementLauncher({ compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(() => {
    try { return unreadAnnouncementCount(localStorage.getItem(READ_CURSOR_KEY)); }
    catch { return announcements.length; }
  });

  const showAnnouncements = () => {
    setOpen(true);
    setUnread(0);
    try {
      const latest = announcements[0];
      if (latest) localStorage.setItem(READ_CURSOR_KEY, latest.id);
    } catch { /* Reading announcements must still work without storage access. */ }
  };

  return <>
    <button
      className={compact ? 'announcement-launcher compact-button' : 'text-button announcement-launcher'}
      type="button"
      onClick={showAnnouncements}
      aria-label={unread ? `公告，${unread} 条未读` : '公告'}
    >
      公告{unread > 0 && <span className="announcement-unread">{unread > 9 ? '9+' : unread}</span>}
    </button>
    {open && <Suspense fallback={null}><AnnouncementCenter onClose={() => setOpen(false)} /></Suspense>}
  </>;
}
