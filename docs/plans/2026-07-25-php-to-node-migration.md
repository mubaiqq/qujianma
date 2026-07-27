# 取件助手 Node.js 迁移实施计划

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 在不中断现有 PHP 生产站的前提下，将取件助手渐进迁移为规范的 Node.js + TypeScript 模块化单体，保留现有前端、数据库数据和 Android API 合同，并将后台任务迁移为独立可观测 Worker。

**Architecture:** 新项目使用 Fastify 提供兼容 `.php` 路径的 HTTP API，按领域拆分 route/service/repository/schema；API 与 Worker 使用同一代码库、独立进程。迁移期连接现有 MySQL，但副作用功能按模块单写者原则切换，旧站在总验收前持续运行。

**Tech Stack:** Node.js 22、TypeScript strict、Fastify、mysql2、Zod、Pino、Vitest、systemd、Nginx、MySQL 8/MariaDB。

---

## 执行纪律

1. 每开始一个任务，先阅读 `MIGRATION.md`。
2. 每个行为严格执行 RED → GREEN → REFACTOR。
3. 每个任务完成后运行目标测试、全量 Node 测试及相关 PHP 回归测试。
4. 每个迁移单元完成后更新 `MIGRATION.md` 勾选和迁移日志。
5. 旧生产项目只读审计；除非迁移兼容需要且已备份，不修改旧项目。
6. 每个任务应形成独立提交，方便中断恢复和回滚。

## 第一里程碑：可访问的规范骨架

### Task 1：建立 TypeScript 工程配置

**Objective:** 建立可构建、可测试、严格类型检查的 Node 项目。

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `.gitignore`
- Create: `.env.example`
- Test: `tests/project-structure.test.ts`

**Steps:**
1. 先写工程结构测试，断言必需脚本和严格 TS 配置。
2. 运行 `npm test -- tests/project-structure.test.ts`，确认因文件缺失失败。
3. 添加最小配置和依赖。
4. 运行测试、`npm run typecheck`、`npm run lint`。
5. 更新 `MIGRATION.md` 并提交。

### Task 2：配置、日志和错误边界

**Objective:** 所有进程通过同一套 Zod 配置校验、Pino 日志和统一错误结构运行。

**Files:**
- Create: `src/platform/config.ts`
- Create: `src/platform/logger.ts`
- Create: `src/platform/errors.ts`
- Test: `tests/platform/config.test.ts`
- Test: `tests/platform/errors.test.ts`

**Acceptance:** 缺失必要配置时启动失败且不打印秘密；错误响应保持 `code/message`。

### Task 3：数据库连接与只读探针

**Objective:** 使用 mysql2 连接当前数据库，并在不写数据的情况下验证 schema。

**Files:**
- Create: `src/platform/database.ts`
- Create: `src/platform/schema-contract.ts`
- Test: `tests/integration/database-readiness.test.ts`

**Acceptance:** 检查 12 张现有业务表和关键字段，不执行自动建表，不修改生产数据。

### Task 4：Fastify API 与健康检查

**Objective:** 建立 API 进程和业务可区分的存活/就绪探针。

**Files:**
- Create: `src/app.ts`
- Create: `src/server.ts`
- Create: `src/modules/health/routes.ts`
- Test: `tests/http/health.test.ts`

**Routes:**
- `GET /health/live`：只证明进程存活
- `GET /health/ready`：验证数据库、应用版本；Worker 未迁移前明确返回 `worker: pending_migration`

### Task 5：Worker 骨架与心跳

**Objective:** 建立独立 Worker 进程、数据库租约和可观测心跳，但暂不发送通知。

**Files:**
- Create: `migrations/0001_worker_runtime.sql`
- Create: `src/platform/migrations.ts`
- Create: `src/worker.ts`
- Create: `src/modules/worker/heartbeat.ts`
- Test: `tests/integration/worker-heartbeat.test.ts`

**Acceptance:** 两个 Worker 同时启动时只有有效租约者执行扫描；停止 Worker 后就绪接口能报告心跳过期。

### Task 6：部署骨架域名

**Objective:** 将 API 与 Worker 作为两个 systemd 服务部署到新域名，不影响旧站。

**Files:**
- Create: `deploy/systemd/qujianma-node-api.service`
- Create: `deploy/systemd/qujianma-node-worker.service`
- Create: `deploy/nginx/pickup-next.conf`
- Create: `scripts/deploy.sh`
- Create: `scripts/verify-deployment.sh`

**Acceptance:** `https://pickup-next.mubaiyun.xyz/health/live` 与 `/health/ready` 返回预期；API/Worker 任一停止时探针和日志能区分故障。

## 第二里程碑：前端原样交付与认证兼容

### Task 7：复制并校验静态资产

将旧项目 `assets/`、`favicon.ico`、`manifest.webmanifest`、`service-worker.js` 复制到 `public/`，建立 SHA-256 清单测试；不得在复制时改 UI。

### Task 8：迁移页面入口

迁移 `/login.php`、`/`、`/guide.php`、`/android.php`，先使用模板适配现有 `window.PICKUP` 数据；验证页面标题、关键 DOM ID、CSS/JS 版本和移动端几何。

### Task 9：认证密码兼容

建立 PHP 密码哈希验证合同，支持当前数据库中的 bcrypt/argon；注册继续生成 PHP 可验证的密码哈希。

### Task 10：Cookie 与会话兼容

迁移 Cookie Token 哈希、滑动续期、`GET /api/session.php`、CSRF HMAC；用真实 Cookie jar 验证 401/200、旧 Token 识别和多设备登录。

### Task 11：账号接口

逐 action 迁移 register/login/logout/change_password；每个 action 单独 TDD，保持状态码和中文消息，改密后撤销全部 Web 会话但不撤销 API/App Token。

## 后续里程碑

严格按照 `MIGRATION.md` 的阶段 D 至 J 顺序执行：

1. 核心包裹与驿站；
2. Token、Android 和短信接入；
3. AI 配置、识别和图片；
4. 分享；
5. Web Push 和 Worker；
6. 管理、迁移、部署和更新；
7. 双跑对比、Android 验收和正式切换。

每个接口都先从 `docs/API.md` 和 PHP 源码提取合同夹具，再实现 Node 版本。不得按“模块一次全部实现”的水平切片方式开发；应按单接口、单 action 的端到端垂直切片推进。
