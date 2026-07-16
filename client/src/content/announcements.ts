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
    id: '2026-07-15-five-characters-and-movement',
    title: '五名新角色加入，圆形战场开始移动',
    summary: '皮卡丘、李淳罡、凹、梦魇与泥岩现已可玩，并带来位移、路径、被动、冷却、屏障、沉睡与黑暗。',
    publishedAt: '2026-07-15',
    version: 'v0.2.0',
    pinned: true,
    tags: ['新角色', '规则更新'],
    sections: [
      {
        heading: '五种全新战斗方式',
        items: [
          '皮卡丘以迅雷改变站位，再用十伯伏特或十万伏特向圆盘两侧传导。',
          '李淳罡以更低消耗使用斩，并在行动公开后释放剑气或一剑开天门。',
          '凹通过资源行动积累熟练，解锁后发吸取与可自由混付资源的凹凹神功。',
          '梦魇铺设梦径、制造黑暗，并在两回合窗口中选择一次鬼影冲刺。',
          '泥岩锤炼拳势、生成屏障，并通过沉睡换取斩与临时攻击加成。',
        ],
      },
      {
        heading: '底层规则同步升级',
        items: [
          '速度现在参与服务端权威结算，较快位移会改变随后范围和传导技能的目标。',
          '角色被动、状态授予技能、分数资源、任意资源混付和单目标后发选择都进入共享配置与校验。',
          '黑暗期间客户端会遮蔽其他地块的角色状态和战斗结果。',
        ],
      },
    ],
  },
  {
    id: '2026-07-15-room-list-and-regent',
    title: '公开房间列表上线，新角色「储君」加入战场',
    summary: '现在可以直接浏览公开房间；群星王座的继承人也带着辉星与君王之剑登场。',
    publishedAt: '2026-07-15',
    pinned: true,
    tags: ['功能更新', '新角色'],
    sections: [
      {
        heading: '更容易找到对局',
        items: [
          '大厅新增公开房间列表，显示房间号、房主昵称、当前人数与创建时间。',
          '列表只展示仍有玩家、尚未锁定且未设为私密的房间，可直接选择并加入。',
          '房间码输入仍是大厅的主要入口；创建房间保留在独立展开区域。',
        ],
      },
      {
        heading: '新角色：储君',
        paragraphs: [
          '群星王座的继承人，拥有宇宙的力量，但总是让他的仆从们去做各种事情。首次变身为储君时会获得 3 辉星，辉星与君王之剑状态在切换角色后仍会保留。',
        ],
        items: [
          '积攒并消耗辉星，使用收集光辉、流光溢彩、粒子墙和胜券在王组织攻防。',
          '“星尘”是首个后发技能：所有行动公开后，再把多个 0.5 级攻击分配给目标。',
          '通过铸剑者、筑墙或征召上前锻造君王之剑；征召上前可以从 0 锻造直接生成一把 0.5 级王剑，也能重新激活锁定的王剑。',
        ],
      },
      {
        heading: '同步完善',
        paragraphs: [
          '本次更新同时加入动态技能参数、半点锻造层数、后发目标阶段，以及储君专属立绘和角色说明。欢迎通过战斗日志反馈数值与交互体验。',
        ],
      },
    ],
  },
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
