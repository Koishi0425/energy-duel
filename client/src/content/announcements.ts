export interface AnnouncementSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export interface Announcement {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  version?: string;
  pinned?: boolean;
  tags: string[];
  sections: AnnouncementSection[];
}

/** Newest announcements must stay first. IDs are persistent unread cursors. */
export const announcements: readonly Announcement[] = [
  {
    id: '2026-07-15-first-public-test',
    title: '欢迎来到《娇斯拉大战贡刚》首次公开测试',
    summary: '圆形竞技场已经开放，感谢你成为第一批进入战场的玩家。',
    publishedAt: '2026-07-15',
    version: 'v0.1.0',
    pinned: true,
    tags: ['项目公告', '首次测试'],
    sections: [
      {
        heading: '目前可以体验什么',
        items: [
          '使用纯用户名进入游戏，自定义房间号并邀请最多 20 名玩家加入。',
          '在可旋转的圆形战场中准备、选择行动、查看结算动画与按回合整理的战斗日志。',
          '使用基础招式，并在娇斯拉与贡刚之间切换，体验角色技能树和条件解锁技能。',
          '对局结束后全员确认结算，无需退出房间即可准备下一局。',
        ],
      },
      {
        heading: '这是一个仍在成长的版本',
        paragraphs: [
          '当前立绘、Emoji 动画和部分界面仍是测试素材。规则、数值与操作体验会继续调整，偶尔也可能出现断线、显示不同步或房间异常。',
          '用户名登录不设密码，不具备身份保护能力。请不要把现实中的敏感身份信息作为用户名。服务器维护和版本更新也会结束正在进行的对局。',
        ],
      },
      {
        heading: '反馈问题时请告诉我们',
        items: [
          '发生问题的大致时间、房间号和操作步骤。',
          '使用的设备、浏览器，以及当时的网络环境。',
          '战斗日志、控制台错误或不包含私人信息的截图。',
        ],
      },
      {
        heading: '接下来',
        paragraphs: [
          '后续将继续完善位移与范围、技能和 Buff 规则、角色动作差分、专属美术资源及角色编辑器。感谢每一次游玩和反馈，它们会直接帮助我们把战场做得更清楚、更稳定，也更有策略性。',
        ],
      },
    ],
  },
];

export function unreadAnnouncementCount(lastReadId: string | null): number {
  if (!lastReadId) return announcements.length;
  const cursor = announcements.findIndex((announcement) => announcement.id === lastReadId);
  return cursor < 0 ? announcements.length : cursor;
}
