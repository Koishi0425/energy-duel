import { describe, expect, it } from 'vitest';
import { announcements, unreadAnnouncementCount } from './announcements';

describe('announcements', () => {
  it('keeps stable unique IDs in newest-first order', () => {
    expect(new Set(announcements.map((item) => item.id)).size).toBe(announcements.length);
    expect(announcements.map((item) => item.publishedAt)).toEqual(
      [...announcements].map((item) => item.publishedAt).sort().reverse(),
    );
  });

  it('publishes v0.5.1 before the stable v0.5.0, v0.4.3, v0.4.2 and v0.4.1 announcements', () => {
    expect(announcements[0]).toMatchObject({
      id: '2026-07-23-v051-character-rules-and-lotus-seat',
      version: 'v0.5.1',
      title: 'v0.5.1：角色规则修正与托生莲座信息完善',
    });
    expect(announcements[1]).toMatchObject({
      id: '2026-07-22-v050-room-routing-live-lobby-and-new-characters',
      version: 'v0.5.0',
      title: 'v0.5.0：房间重构、实时大厅与三名新角色',
    });
    expect(announcements[2]).toMatchObject({
      id: '2026-07-21-v043-emote-wheel-and-board-clarity',
      version: 'v0.4.3',
      title: 'v0.4.3：表情轮盘与棋盘显示优化',
    });
    expect(announcements[3]).toMatchObject({
      id: '2026-07-20-v042-targeting-and-action-categories',
      version: 'v0.4.2',
      title: 'v0.4.2：角色状态、目标判定与技能修正',
    });
    expect(announcements[4]).toMatchObject({
      id: '2026-07-20-v041-damage-rules-and-star-god',
      version: 'v0.4.1',
      title: 'v0.4.1：伤害体系、星神、内卫与棋盘对象更新',
    });
    expect(announcements[4].sections.map((section) => section.heading)).toEqual([
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
