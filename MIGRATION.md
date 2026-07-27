# 取件助手 PHP → Node.js 迁移总台账

> 本文件是迁移工作的唯一进度依据（Source of Truth）。每完成一个可验证的迁移单元，必须在对应条目前打勾，并在“迁移日志”记录日期、验证命令和结果。任何新会话都应先阅读本文件，再继续下一项未完成任务。

## 0. 固定信息

- 旧生产项目：`/home/ubuntu/express-pickup`
- 旧生产域名：`https://pickup.mubaiyun.xyz`
- Docker 旧项目：`/home/ubuntu/qujianma-dk`
- 新 Node.js 项目：`/home/ubuntu/qujianma-node`
- 新迁移域名：`https://pickup-next.mubaiyun.xyz`
- 新服务端口：`32200`
- 数据库：迁移期连接现有 MySQL `express_pickup`，禁止破坏性结构变更
- 前端原则：保留现有 UI、交互和静态资源，不在后端迁移时同步改版
- 切换原则：旧 PHP 持续生产运行；新 Node 按模块验证，未完成总验收前不替换旧域名

## 1. 迁移完成定义（Definition of Done）

每个勾选项必须同时满足：

1. 有对应的兼容合同测试；
2. 新测试在实现前曾因功能缺失而失败（RED）；
3. Node 实现后测试通过（GREEN）；
4. 相关旧 PHP 回归测试仍通过；
5. 在 `pickup-next.mubaiyun.xyz` 通过真实 HTTP 验证；
6. 涉及数据库写入时，验证用户隔离、事务和幂等性；
7. 涉及 Android 时，HTTP 状态码、JSON 字段、Cookie、CSRF 与 Token 行为保持兼容；
8. 本文件已更新勾选与迁移日志。

仅“代码已写”不得勾选。

## 2. 强制兼容规则

- [ ] Cookie 名沿用旧站 `COOKIE_NAME`，登录 Token 仍只存 SHA-256 哈希
- [ ] Cookie 保持 `Secure; HttpOnly; SameSite=Lax; Path=/`，有效期 365 天并滑动续期
- [ ] 兼容 PHP `password_hash/password_verify` 生成的 bcrypt/argon 哈希
- [ ] CSRF 继续为原始 Cookie Token 的 HMAC-SHA256，现有网页与 Android 无需修改
- [ ] `APP_KEY_HEX` 沿用旧值；AES-256-GCM 密文格式保持 `base64(iv12 + tag16 + ciphertext)`
- [ ] API 成功/失败结构保持 `code/message/data`，短信接口继续提供机器可读 `status`
- [ ] 保留 `.php` 路径兼容，例如 `/api/session.php`，同时内部路由不得依赖 PHP
- [ ] ID/计数兼容旧 PHP 返回字符串的情况；Android 客户端不得被强制升级
- [ ] 所有查询必须按 `user_id` 隔离；管理员仍严格绑定 `user_id=1`
- [ ] 时区固定 `Asia/Shanghai`
- [ ] 不记录登录 Token、API Token、短信正文、图片、AI Key 等敏感数据

## 3. 目标架构

- `src/server.ts`：Fastify HTTP API 与页面服务
- `src/worker.ts`：独立后台任务进程，不依赖系统 Cron
- `src/modules/*`：按领域拆分 route/service/repository/schema
- `src/platform/*`：配置、数据库、加密、认证、日志、错误处理
- `public/*`：从旧项目复用的前端静态资产
- `views/*`：页面模板或静态页面入口
- `tests/contracts/*`：旧接口响应合同
- `tests/integration/*`：真实 MySQL 与 HTTP 集成测试
- `migrations/*`：Node 新增结构迁移；不得修改旧历史迁移

部署时使用同一构建产物运行两个 systemd 服务：

- `qujianma-node-api.service`
- `qujianma-node-worker.service`

## 4. 阶段与迁移清单

### 阶段 A：审计、文档和工程骨架

- [x] 建立独立 Git 项目目录
- [x] 建立本迁移总台账
- [x] 完成旧系统页面、API、数据表、任务和静态资产清单
- [x] 固化旧 API 合同快照和安全脱敏夹具
- [x] 建立 TypeScript 严格模式、ESLint、Vitest、构建脚本
- [x] 建立统一配置校验与 `.env.example`
- [x] 建立结构化日志和统一错误响应
- [x] 实现 `/health/live` 与 `/health/ready`
- [x] 部署 API 骨架到 `pickup-next.mubaiyun.xyz`
- [ ] 部署 Worker 骨架并提供可观测心跳

### 阶段 B：前端与公开页面

- [x] 复制并校验 Font Awesome、本地图标、快递 Logo、CSS、Service Worker、Manifest
- [ ] 迁移登录/注册页面，保持当前按钮成功反馈与无原生弹窗
- [ ] 迁移主页面 HTML，保持当前移动端样式与底部液态玻璃 Tab
- [ ] 迁移使用教程页 `/guide.php`（当前在认证迁移完成前明确重定向 `/login.php`，保持旧站登录边界）
- [x] 迁移 Android 下载页 `/android.php`
- [ ] 迁移公开分享页 `/share.php?t=...`
- [ ] 迁移管理员页面 `/admin/` 与 `/admin/user.php`
- [ ] 验证移动端无横向溢出、iOS 输入框不缩放、固定导航不遮挡

### 阶段 C：账号、会话与安全基础

- [ ] `POST /api/account.php`：register
- [ ] `POST /api/account.php`：login
- [ ] `POST /api/account.php`：logout（仅当前设备）
- [ ] `POST /api/account.php`：change_password（撤销全部 Web 登录）
- [ ] `GET /api/session.php`
- [ ] Cookie 滑动续期与失效 Cookie 清理
- [ ] CSRF 校验兼容
- [ ] ID=1 管理员鉴权
- [ ] PHP 旧 Cookie 可直接登录 Node 域名的迁移策略验证

### 阶段 D：核心包裹与驿站

- [ ] `GET /api/parcels.php?view=home`
- [ ] `GET /api/parcels.php?view=records` 全部时间筛选
- [ ] `POST /api/parcels.php`：mark_picked
- [ ] `POST /api/parcels.php`：undo_picked
- [ ] `POST /api/stations.php`：驿站批量取件
- [ ] `GET /api/my_stations.php`
- [ ] `POST /api/my_stations.php`：save
- [ ] `POST /api/my_stations.php`：delete 与活跃包裹保护
- [ ] 10 秒静默增量检查与局部 DOM 更新保持不变

### 阶段 E：Token、Android 与短信接入

- [ ] `GET /api/tokens.php`
- [ ] `POST /api/tokens.php`：regenerate
- [ ] `GET /api/app_devices.php`
- [ ] `POST /api/app_devices.php`：register（同 UUID 幂等恢复 Token）
- [ ] `POST /api/app_devices.php`：revoke
- [ ] `POST /api/app_devices.php`：register_push（未配置时继续明确 503）
- [ ] `POST /api/app_devices.php`：unregister_push
- [ ] Bearer 与 `?k=` 双通道 Token 鉴权
- [ ] `GET/POST /api/ingest.php` 全部兼容传输方式
- [ ] `POST /api/manual_ingest.php`
- [ ] Android 现有真实接口回归矩阵全部通过

### 阶段 F：AI 配置、文字识别与图片识别

- [ ] AI Key 旧密文解密兼容
- [ ] `GET /api/ai_status.php`
- [ ] `GET /api/ai_settings.php`
- [ ] `POST /api/ai_settings.php`：save/select/delete/test/fetch_models
- [ ] SSRF 防护与 OpenAI 兼容 URL 规范化
- [ ] 文字 AI 固定 JSON 规范与保守本地降级
- [ ] 驿站确定性匹配规则逐条迁移
- [ ] `POST /api/retry_ai.php`
- [ ] `POST /api/image_recognize.php`
- [ ] 一图多取件码、最多 5 图、压缩和错误原因保持一致
- [ ] 旧语义识别夹具在 Node 下全部通过

### 阶段 G：分享

- [ ] `POST /api/share_links.php`：status
- [ ] `POST /api/share_links.php`：create/reuse/regenerate
- [ ] `POST /api/share_links.php`：cancel 并撤销全部活跃链接
- [ ] 24 小时过期逻辑
- [ ] 公开分享页待取列表和复制全部
- [ ] 分享页标记已取
- [ ] 分享 Token 哈希查询与原文加密兼容

### 阶段 H：Web Push 与后台 Worker

- [ ] `GET /api/notifications.php`
- [ ] `POST /api/notifications.php`：subscribe/unsubscribe
- [ ] `POST /api/notifications.php`：save_preferences
- [ ] `POST /api/notifications.php`：test_push 真实服务端投递
- [ ] Worker 心跳表和后台状态接口
- [ ] 每日提醒任务
- [ ] 18:00 后 24h/48h/3d 逾期提醒
- [ ] 数据库锁保证多 Worker 不重复执行
- [ ] 失败次数、最后错误、下次重试时间可查询
- [ ] 管理后台显示 Worker 最近心跳、扫描和发送结果
- [ ] 停止 Worker 后健康状态能明确报警

### 阶段 I：管理员、版本与运维

- [x] `GET /api/version.php`
- [ ] 管理员总览统计
- [ ] 用户详情与敏感字段排除
- [ ] 数据库迁移 CLI，支持 dry-run/status/up
- [ ] 首次部署脚本（幂等）
- [ ] 一键更新脚本：备份→构建→迁移→测试→重启→探针→失败回滚
- [ ] Docker Compose：API、Worker、可选 MySQL 分服务
- [ ] systemd：API、Worker 分服务
- [ ] 健康检查覆盖 DB、Worker 心跳和版本
- [ ] 日志轮转、备份恢复与故障排查文档

### 阶段 J：双跑、切换与回滚

- [ ] 旧 PHP 与新 Node 只读结果对比
- [ ] 写接口使用隔离测试账号做双端语义对比
- [ ] Android App 指向新域名完整验收
- [ ] Web Push 真实设备端到端验收
- [ ] 分享链接跨新旧实现验证
- [ ] 数据库备份恢复演练
- [ ] Nginx 切换演练及 5 分钟回滚验证
- [ ] 正式切换 `pickup.mubaiyun.xyz`
- [ ] 旧 PHP 保留只读/回滚窗口
- [ ] 稳定期结束后归档旧项目，停止双仓库同步

## 5. 明确禁止事项

- 不直接修改或停掉当前 PHP 生产站；
- 不在未备份时执行数据库结构变更；
- 不让 PHP 与 Node 同时消费同一个会产生副作用的后台任务；
- 不用“健康接口 200”代替业务级验证；
- 不因 TypeScript 重写而改变 Android 现有字段或错误状态；
- 不把现有 UI 迁移顺便变成前端重构；
- 不新增 Redis、消息队列或微服务，除非数据库锁方案经验证确实不够；
- 不提交 `.env`、旧站配置、用户数据、Token、AI Key、VAPID 私钥。

## 6. 迁移日志

- 2026-07-25：创建 `/home/ubuntu/qujianma-node` 独立 Git 项目和迁移总台账；确定新域名 `pickup-next.mubaiyun.xyz`、端口 `32200`，旧 PHP 生产站保持不变。
- 2026-07-25：完成旧系统页面/API/12 张数据表/认证/密码学/定时任务审计，详见 `docs/legacy-system-audit.md` 与 `docs/contracts/legacy-api-contract.md`。
- 2026-07-25：按 TDD 建立 Node 22、TypeScript strict、ESLint、Vitest 工程配置；验证 `2 tests passed`、typecheck/lint 通过、npm audit 0 vulnerabilities。
- 2026-07-25：完成统一配置校验、结构化错误边界及健康检查首个垂直切片；全量 `6 tests passed`，typecheck/lint/build 通过；真实端口 32200 验证 live=200、ready=degraded（数据库/Worker 明确待迁移）、未知路由=404。
- 2026-07-25：API 骨架已作为 `qujianma-node-api.service` 部署；Nginx 与 Let's Encrypt 已启用 `https://pickup-next.mubaiyun.xyz`。公网验证 HTTPS live=200、HTTP→HTTPS=301，证书有效期至 2026-10-23；旧站未改动。
- 2026-07-25：原样复制旧站 CSS/JS/Font Awesome/图标/快递 Logo/PWA 文件并以 SHA-256 合同校验；迁移 Android 1.0.0 页面至 `/android.php`。修复 Fastify 静态文件覆盖自定义缓存头的问题，目标测试 3 项、全量 9 项均通过。
- 2026-07-25：创建 MySQL 仅 SELECT 迁移账号，完成 utf8mb4、+08:00、12 张核心旧表和无写权限集成探针；公网 `/health/ready` 已显示 `database=ready_read_only`。
- 2026-07-25：迁移公开 `/api/version.php`，保持旧 PHP 的 JSON、Cache-Control、Pragma 和方法行为；公网合同验证通过。建立 SHA-256、CSRF HMAC 与 AES-256-GCM 的 PHP 交叉测试向量；当前全量 17 项测试通过，数据库集成 3 项另行实跑通过。
- 2026-07-25：关闭独立审查发现的前端阻塞：移除重复静态入口、编码路径穿越稳定返回 400、仅版本化资源使用 immutable、构建产物包含 public/views、`/guide.php` 在认证迁移前保持登录重定向边界。公网逐项验证通过。
- 2026-07-25：数据库就绪授权改为 fail-closed，仅接受 `USAGE ON *.*` 与目标库 `SELECT`；真实执行零影响 UPDATE/DELETE 验证服务器拒绝，成功/错误路径均压测连接释放。生产 Schema 差异仅记录不修改。
- 2026-07-25：完成 PHP `$2y$` bcrypt 密码兼容模块；Node 验证 `$2y$/$2b$`，新哈希可由 PHP `password_verify` 验证。当前全量 42 项测试通过、数据库集成 7 项实跑通过，typecheck/lint/build 通过。
- 2026-07-25：新域名启用 Nginx 白名单渐进代理：已迁移的健康、版本、Android 与静态资源由 Node 处理；尚未迁移的主页、登录、教程、分享、后台与旧 API 由本机 PHP 原样处理。未知路径由 Node 统一 404，旧站与新域名使用各自 host-only Cookie。公网验证登录页=200、未登录主页=302、session=401、Node 路由=200。
- 2026-07-25：使用隔离临时账号在新域名完成真实注册→Cookie→session/CSRF→登录后主页端到端验证；数据库确认 users/login_tokens/api_tokens 各 1 条后清理，最终测试账号残留为 0。Node 原生 session/account 领域切片与未公开登录模板完成，尚未注册生产路由；全量 78 项测试、typecheck/lint/build/audit 通过。
- 2026-07-25：根据独立安全审查补强 bcrypt cost 白名单（10-12，拒绝高成本哈希 DoS）与 PHP strict base64 的空白/无 padding 兼容边界，增加错误密钥、非法格式和固定 cost 12 测试。
- 2026-07-25：修复前端迁移审查阻塞：移除重复 `/__static__/` 暴露，asset 穿越/畸形路径稳定返回 400/404 且不泄露，仅非空 `v` 查询启用一年 immutable；认证尚未迁移期间 `/guide.php` 明确 302 到 `/login.php`，Android 教程链接不再死链。构建现会将 `public/`、`views/` 复制进 `dist/`；目标 12 项、全量 42 项测试通过（7 项需真实数据库而跳过），typecheck/lint/build 与 dist 运行时探针通过。教程内容和认证接通未完成，故教程迁移项保持未勾选。

## 7. 已知生产 Schema 差异（只记录，不自动迁移）

- 2026-07-25 实库只读核验：除迁移合同要求的 12 张核心旧表外，实际库额外存在 `share_tokens`；当前就绪探针允许额外表，不将其加入自动建表或删表流程。
- 2026-07-25 实库只读核验：`share_links.token_ciphertext` 当前为 nullable（`IS_NULLABLE=YES`）；Node 迁移必须兼容该现状，不由就绪探针执行 `ALTER TABLE` 或其他结构修复。
