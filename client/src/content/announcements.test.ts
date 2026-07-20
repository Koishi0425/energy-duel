import { describe, expect, it } from 'vitest';
import { announcements, unreadAnnouncementCount } from './announcements';

describe('announcements', () => {
  it('keeps stable unique IDs in newest-first order', () => {
    expect(new Set(announcements.map((item) => item.id)).size).toBe(announcements.length);
    expect(announcements.map((item) => item.publishedAt)).toEqual(
      [...announcements].map((item) => item.publishedAt).sort().reverse(),
    );
  });

  it('publishes the combined v0.4.1 announcement first', () => {
    expect(announcements[0]).toMatchObject({
      id: '2026-07-20-v041-damage-rules-and-star-god',
      version: 'v0.4.1',
      title: 'v0.4.1：伤害体系、星神、内卫与棋盘对象更新',
    });
    expect(announcements[0].sections.map((section) => section.heading)).toEqual([
      '伤害与防御体系',
      '3 级攻击回溯即死',
      '星神正式开放',
      '内卫正式加入',
      '国度与棋盘对象',
      '角色规则修正',
    ]);
  });

  it('counts announcements newer than the read cursor', () => {
    expect(unreadAnnouncementCount(null)).toBe(announcements.length);
    expect(unreadAnnouncementCount(announcements[0].id)).toBe(0);
    expect(unreadAnnouncementCount('unknown-release')).toBe(announcements.length);
  });
});
