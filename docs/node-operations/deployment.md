# Node 运维手册

## 安全边界

仓库内脚本只生成发布目录；默认不会安装/启动 systemd、修改 Nginx 或连接生产库。执行前用独立低权限账号审阅 `.env`，数据库迁移账号只在迁移窗口提供。API 与 Worker 同时运行前必须确认旧 PHP/Cron 消费者已停用，避免双写。

## 首次部署

1. 创建服务用户与 `/opt/qujianma-node`（由管理员操作）。
2. `APP_ROOT=/opt/qujianma-node SOURCE_DIR=$PWD scripts/node-first-deploy.sh`；首次会生成 `shared/app.env` 并退出。
3. 填写环境变量，重跑。脚本可重复运行，每次生成不可变 release，不覆盖共享配置。
4. `node scripts/node-migrate.mjs status`、`dry-run`，备份后才运行 `up`。
5. 审阅并复制 `deploy/node/systemd/*.service`，执行 daemon-reload/enable/start（本仓库不自动执行）。
6. 分别探测 API readiness，并检查 Worker 的业务结果，不能只看进程存活。

## 一键更新

`node-update.sh` 顺序固定为：数据库备份 → 拉取 → 依赖 → 构建 → dry-run/up → 测试 → current 原子切换 → 可选重启 → IPv4 readiness 探针。默认 `APPLY_SYSTEMD=0`；生产经授权设置为 `1`。失败会恢复旧 release 并重启旧代码；MySQL DDL 可能隐式提交，脚本不会冒险自动恢复数据库，会明确告警并保留备份。

国内网络默认 npm 镜像失败后回退官方源；GitHub 可设置 `GITHUB_ACCELERATOR=https://...`，失败回退直连。Git 固定 HTTP/1.1 并带总超时，curl 固定 IPv4、连接/总超时及指数重试。

## Docker

```bash
cd deploy/node
# Docker 面板导入 compose.yaml，或直接启动；首次打开网页完成安装
docker compose up -d
```

首次安装由网页完成数据库初始化、管理员创建和迁移，不需要命令行操作。
