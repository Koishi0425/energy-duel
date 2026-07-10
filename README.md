# ⚔ 蓄气对决 (Energy Duel)

在线多人拍手对战游戏。攒气、出招、一击必杀。

## 核心机制

- **26 种招式** × **13 个等级**，从基础的「运」「防」「波」到终极「降龙十八掌」「毒」
- **能量经济**：出招消耗气，运攒气，欧偷气，跺反制
- **一击必杀**：HP=1，对攻差 ≥9 定生死，否则平局
- **同时回合制**：每回合所有人暗中选招，同时揭晓
- **升级系统**：每局 Top N 升级，解锁更强招式

## 快速开始

### 服务端

```bash
cd server
npm install
npx tsx src/index.ts   # 开发模式，端口 3000
```

### 客户端（本地开发）

```bash
cd client
npm install
npm run dev             # Vite dev server，端口 5173
```

打开 `http://localhost:5173` 即可游玩。

### 外网联机

```bash
ngrok http 3000          # 把服务端暴露到公网
cd client && npm run build   # 构建生产版客户端
```

修改 `client/src/socket.ts` 的 `SERVER_URL` 为 ngrok 地址后重新构建。

## 技术栈

| 层 | 技术 |
|----|------|
| 客户端 | React 18 + TypeScript + Vite |
| 服务端 | Node.js + Express + Socket.IO |
| AI | 自研 minimax 博弈树 + 策略自适应 |
| 部署 | GitHub Pages (客户端) + ngrok/Render (服务端) |

## 人机 AI

| 难度 | 策略 |
|------|------|
| 🤖 简单 | minimax 递归评估 + 策略自适应 + 防卡死检测 |
| 🧠 普通 | 上下文过滤 + N 选 1 随机（不可预测） |
| 💀 困难 | 后手反制：看所有人出招后选最优解 |

## 项目结构

```
energy-duel/
├── client/                # React 前端
│   └── src/
│       ├── App.tsx        # 主状态机
│       └── components/    # 游戏 UI 组件
├── server/                # Node.js 后端
│   └── src/
│       ├── index.ts       # Express 入口 + REST API
│       ├── socket.ts      # Socket.IO 事件
│       ├── game/          # 游戏引擎
│       │   ├── GameEngine.ts    # 回合调度
│       │   ├── BotEngine.ts     # 人机 AI
│       │   ├── MoveResolver.ts  # 战斗结算
│       │   ├── EnergyResolver.ts # 能量/欧链
│       │   └── LevelResolver.ts # 排名/升级
│       ├── room/          # 房间管理
│       └── auth/          # 账号系统
└── shared/                # 共享类型定义
    └── types.ts
```

## 许可

MIT
