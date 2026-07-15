import { describe, expect, it } from 'vitest';
import { announcements, unreadAnnouncementCount } from './announcements';

describe('announcements', () => {
  it('keeps stable unique IDs in newest-first order', () => {
    expect(new Set(announcements.map((item) => item.id)).size).toBe(announcements.length);
    expect(announcements.map((item) => item.publishedAt)).toEqual(
      [...announcements].map((item) => item.publishedAt).sort().reverse(),
    );
  });

  it('counts announcements newer than the read cursor', () => {
    expect(unreadAnnouncementCount(null)).toBe(announcements.length);
    expect(unreadAnnouncementCount(announcements[0].id)).toBe(0);
    expect(unreadAnnouncementCount('unknown-release')).toBe(announcements.length);
  });
});
