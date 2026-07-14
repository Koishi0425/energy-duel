# Energy Duel / 能量对决

基于 React、PixiJS 8 和 Colyseus 0.17 的多人在线圆形战棋游戏。

## 当前功能

- 纯用户名账号与独立房间昵称
- 房主创建房间、全员准备、最多 20 人加入
- `2 × 玩家数` 的圆形地图和服务端权威格子位置
- 可拖动旋转的本地战场视角，鼠标与触屏均可操作
- 角色立绘、昵称、生命、通用资源和 Buff 展示底座
- 桌面悬停详情、手机底部详情抽屉和响应式布局
- 攻击、防御、特殊行动标签页，场上高亮选目标和确认弹窗
- 行动提交后可在全员确认前撤销重选
- JSON 驱动的气、凹、剁、波、防、挂机、超防规则
- 对局中 30 秒断线重连；准备和结算阶段断线直接退出

> 无密码用户名不是安全凭据。任何知道用户名的人都可以进入同一账号。

## 开发

需要 Node.js 20+ 和 npm 10+：

```bash
npm install
npm run dev
```

开发客户端运行于 `http://localhost:5173`，Colyseus 服务端运行于
`http://localhost:2567`。

## 角色素材

素材文件放在 `client/public/assets/`，配置只保存资源 ID 和站内 URL。例如：

```text
client/public/assets/portrait-default.png
client/public/assets/characters/ice_mage/base/idle.png
client/public/assets/characters/ice_mage/base/wave.png
```

在 `shared/config/game.json` 的 `assets`、角色 `forms` 和 `poses` 中登记资源。
找不到动作差分时依次回退到形态默认、角色默认和内置占位立绘。

## 生产运行与 ngrok

```bash
npm run serve
```

另开终端执行：

```bash
npm run tunnel
```

客户端静态资源、HTTP API、匹配服务和 WebSocket 共用端口 2567，只需一个
ngrok HTTP 隧道。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

## 目录

```text
client/   React、Ant Design 与 PixiJS 客户端
server/   Colyseus 房间、权威结算与账号 API
shared/   共享 workspace：协议、几何算法和 JSON 游戏配置
```

开始开发前请阅读 [AGENTS.md](./AGENTS.md)。
