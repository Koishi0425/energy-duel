# 娇斯拉大战贡刚

## 容器化部署

项目提供多阶段 `Dockerfile`、单实例 `compose.yaml`、持久化账号卷和健康检查：

```bash
docker compose build --pull
docker compose up -d
curl http://127.0.0.1:2567/api/health
```

服务器初始化、HTTPS/WebSocket 反向代理、备份、更新与回滚流程见
[部署与更新](./docs/部署与更新.md)。

基于 React、PixiJS 8 和 Colyseus 0.17 的多人在线圆形战棋游戏。

## 当前功能

- 纯用户名账号与独立房间昵称
- 房主自定义 4–10 位房间号、全员准备、最多 20 人加入
- `2 × 玩家数` 的圆形地图和服务端权威格子位置
- 可拖动旋转的本地战场视角，鼠标与触屏均可操作
- 角色立绘、昵称、生命、通用资源和 Buff 展示底座
- 桌面悬停详情、手机底部详情抽屉和响应式布局
- 基础、攻击、防御、资源、特殊五类行动；场上点选目标后立即提交，无确认弹窗
- 行动提交后可在全员确认前撤销重选，并获得即时状态反馈
- 初始角色拥有基础招式、挡和超防；娇斯拉与贡刚可免费反复切换，未来角色由配置指定变身消耗
- 可拖动、缩放并直接编辑分类/排序的桌面行动面板；标签页可拆成独立浮窗
- 按速度和稳定玩家 ID 排序、关联动作成组播放的客户端结算时间线与 Emoji 动作动画
- 等级差权威结算、按回合聚合且可拖动缩放的战斗日志，以及确认后继续下一局
- 日志每回合先列出全员行动；角色专属 Buff 切换角色后后台保留并继续计算持续时间
- JSON 驱动的基础招式、通用资源、生命状态与受控效果处理器
- 懒加载的网页教程，以及独立的基础规则和角色信息手册
- 登录页、大厅和战场均可查看带未读提示的项目公告
- 首屏与战场代码分包；`?perf=1` 可查看 FPS、慢帧、长任务、RTT 等指标
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
client/public/assets/default-character.png
client/public/assets/characters/ice_mage/base/idle.png
client/public/assets/characters/ice_mage/base/wave.png
```

在 `shared/config/game.json` 的 `assets`、角色 `forms` 和 `poses` 中登记资源。
找不到动作差分时依次回退到形态默认、角色默认和内置占位立绘。
当前占位立绘会在浏览器首次加载时按 Alpha 边界裁掉透明留白并缩小到最多
512 像素，原文件保持不变。

## 规则手册

- [基础规则手册](./docs/基础规则手册.md)
- [角色信息手册](./docs/角色信息手册.md)

网页的登录页、大厅和游戏房间均提供“教程”入口。可执行规则仍以
`shared/config/game.json` 和服务端结算逻辑为准。

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
docs/     面向玩家和设计者的规则手册
```

开始开发前请阅读 [AGENTS.md](./AGENTS.md)。
