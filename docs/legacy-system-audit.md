# 旧 PHP 系统迁移审计清单

> 审计基线：`/home/ubuntu/express-pickup`，2026-07-25。该清单用于确认迁移覆盖面；接口细节以 `docs/contracts/legacy-api-contract.md` 和旧仓库 `docs/API.md` 为准。

## 页面与静态交付

- `/login.php`：登录/注册
- `/`、`/index.php`：需 Cookie 的主应用（首页、记录、我的）
- `/guide.php`：需登录的使用教程
- `/android.php`：公开 Android 1.0.0 下载页
- `/share.php?t=...`：公开限时分享页及分享取件写操作
- `/admin/`：ID=1 管理员总览
- `/admin/user.php?id=...`：用户详情
- `/assets/css/app.css`：当前完整 UI
- `/assets/js/app.js`：主应用交互、增量同步、AI/通知/分享
- `/assets/js/login.js`：登录注册交互
- `/assets/vendor/fontawesome/*`：本地 Font Awesome
- `/assets/images/couriers/*`：快递 Logo
- `/assets/icons/*`、`favicon.ico`：应用图标
- `/manifest.webmanifest`、`/service-worker.js`：PWA 与 Web Push

## HTTP API

| 路径 | 方法 | 认证 | 主要行为 |
|---|---|---|---|
| `/api/version.php` | GET | 无 | Web 版本与资源版本 |
| `/api/account.php` | POST | action 决定 | register/login/change_password/logout |
| `/api/session.php` | GET | Cookie | 当前用户与真实 CSRF |
| `/api/tokens.php` | GET/POST | Cookie + POST CSRF | iPhone Token 查询/轮换 |
| `/api/app_devices.php` | GET/POST | Cookie + POST CSRF | Android 设备注册、恢复、撤销、推送预留 |
| `/api/ingest.php` | GET/POST | API/App Bearer 或 `?k=` | 多传输格式短信接入 |
| `/api/manual_ingest.php` | POST | Cookie + CSRF | 手动短信、AI 识别并入库 |
| `/api/image_recognize.php` | POST multipart | Cookie + CSRF | 图片 AI 识别并直接批量入库 |
| `/api/parcels.php` | GET/POST | Cookie + POST CSRF | 首页/记录/标记已取/恢复 |
| `/api/stations.php` | POST | Cookie + CSRF | 驿站整组标记已取 |
| `/api/my_stations.php` | GET/POST | Cookie + POST CSRF | 用户驿站 CRUD |
| `/api/ai_settings.php` | GET/POST | Cookie + POST CSRF | 模型配置 CRUD、测试、发现模型、启用 |
| `/api/ai_status.php` | GET | Cookie | 当前 AI 状态 |
| `/api/retry_ai.php` | POST | Cookie + CSRF | 旧来源记录重新识别 |
| `/api/notifications.php` | GET/POST | Cookie + POST CSRF | 偏好、订阅、取消订阅、真实测试推送 |
| `/api/share_links.php` | POST | Cookie + CSRF | status/create/cancel/re-generate |

## 数据表（现有数据库必须兼容）

1. `users`
2. `login_tokens`
3. `api_tokens`
4. `app_devices`
5. `ai_providers`
6. `incoming_messages`
7. `stations`
8. `parcels`
9. `notification_preferences`
10. `push_subscriptions`
11. `share_links`
12. `share_link_parcels`

## 认证与密码学

- Cookie-only 登录；默认 Cookie 示例 `pickup_login`，实际使用旧配置中的 `COOKIE_NAME`
- 登录原文 Token 64 位十六进制，只在 Cookie 中；数据库存 SHA-256
- API Token 原文 48 位十六进制；App Token 原文 64 位十六进制
- CSRF：`HMAC-SHA256('pickup-csrf', rawCookieToken)`，密钥是 Cookie 原文
- 密钥加密：AES-256-GCM；密文为 Base64 编码的 `12-byte IV + 16-byte tag + ciphertext`
- 密码：PHP `PASSWORD_DEFAULT`；Node 必须验证现有哈希并生成可被 PHP 验证的新哈希
- ID=1 是创始管理员，不按用户名判断

## 业务规则高风险区

- 所有业务数据必须用当前 `user_id` 过滤
- 注册要在事务中同时创建用户和独立 iPhone API Token
- Android 同一 `(user_id, device_id)` 注册必须幂等恢复原 Token；撤销后重建必须轮换 Token
- 短信先保存完整来源记录，再识别和创建包裹
- AI 输出是不可信派生数据；取件码必须有当前来源证据
- 文字 AI 不可用时使用保守本地规则；图片无本地 OCR 时不得伪造
- 驿站按品牌+小区/道路匹配，明确门牌号冲突才拆分
- 图片支持最多 5 张、一图多取件码、识别成功直接入库
- 分享只展示待取、24 小时有效、取消时撤销全部活跃链接
- 改密撤销全部 Web 登录，不自动撤销 iPhone/Android Token
- 记录页含来源消息，即使 AI 失败或未创建 parcel 也必须可见

## 后台任务

- PHP 入口：`bin/send_daily_notifications.php`
- 当前触发：系统 Cron 或 Docker 内 Cron，每分钟扫描
- 每日提醒：达到用户 `daily_time` 且当天未成功发送
- 逾期提醒：18:00 后扫描最久待取件，24h/48h/3d 分级，当天最多一次
- 仅在服务端推送成功数大于 0 时写入最后发送日期
- Node 迁移后由独立 Worker 接管；切换前禁止 PHP Cron 与 Node Worker 同时发送

## 部署现状与迁移约束

- 生产 Nginx 根目录：`/home/ubuntu/express-pickup`
- 生产域名：`pickup.mubaiyun.xyz`
- PHP-FPM：8.3
- Docker 旧版把 Nginx、PHP-FPM、MariaDB、Cron 放在同一容器
- 新项目域名：`pickup-next.mubaiyun.xyz`（泛解析已指向当前服务器）
- 新端口：`32200`
- 新项目 API 与 Worker 分 systemd 服务；旧站不停止
