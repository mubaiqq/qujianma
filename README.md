# 取件助手 Node.js 版

取件码管理、图片 AI 识别、通知提醒和分享功能的 Node.js 正式版。

## 一键部署

支持 Ubuntu/Debian，需要 `root` 或 `sudo` 权限，并准备一个可连接的 MySQL 8.0+ 数据库。

```bash
curl -fsSL https://raw.githubusercontent.com/mubaiqq/qujianma/main/install.sh | sudo bash
```

脚本会自动：

- 安装 Node.js 22、Git、Curl
- 下载或更新项目源码
- 安装依赖并完成生产构建
- 创建独立的 `qujianma` 系统用户
- 安装并启用 systemd 服务
- 固定监听端口 `38765`
- 保留已有安装配置，重复执行时直接更新

完成后打开：

```text
http://服务器IP:38765
```

首次打开安装向导，填写：

- 数据库主机与端口
- 数据库名
- 数据库用户名和密码
- 管理员用户名和密码
- 访问地址（可选，用于生成分享链接）

安装向导会自动创建数据表、执行迁移、创建管理员和生成应用密钥，不需要手动执行 SQL。

> 数据库需要预先存在，并且填写的数据库用户需要拥有该数据库的建表、读写和索引权限。数据库可使用宝塔 MySQL、云数据库或其他 MySQL 8.0+ 实例。

## 宝塔使用

1. 在宝塔终端执行上面的一键部署命令。
2. 在安全组和宝塔防火墙中临时放行 TCP `38765`。
3. 打开 `http://服务器IP:38765` 完成安装。
4. 如需域名，在宝塔添加反向代理：

```text
http://127.0.0.1:38765
```

项目不会自动修改 Nginx、域名、SSL 或 MySQL，避免影响服务器上的其他网站。

## 更新

重复执行同一个命令即可幂等更新：

```bash
curl -fsSL https://raw.githubusercontent.com/mubaiqq/qujianma/main/install.sh | sudo bash
```

已有 `/opt/qujianma-node/shared/app.env`、上传文件和数据库不会被清除。

## 常用命令

```bash
sudo systemctl status qujianma-node-api
sudo systemctl status qujianma-node-worker
sudo systemctl status qujianma-node-recognition-worker
sudo journalctl -u qujianma-node-api -f
sudo systemctl restart qujianma-node-api qujianma-node-worker qujianma-node-recognition-worker
```

## 数据目录

```text
/opt/qujianma-node/source                         当前源码
/opt/qujianma-node/shared/app.env                 安装配置和密钥
/opt/qujianma-node/shared/recognition-uploads     待识别图片
```

删除 `app.env` 会重新进入安装向导，但不会自动删除数据库；重新安装前请先做好数据库备份。

## 运行要求

- Ubuntu/Debian
- Node.js 22（脚本自动安装）
- MySQL 8.0+
- 默认端口：`38765`
