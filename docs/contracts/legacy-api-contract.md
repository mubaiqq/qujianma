# 旧接口兼容合同（Node 迁移基线）

## 全局响应

- JSON UTF-8，`Cache-Control: no-store`
- 成功通常为 `{"code":0,"message":"...","data":...}`
- 失败通常为 `{"code":1,"message":"..."}`
- 短信接入额外返回 `status`
- HTTP 状态必须保留：400/401/403/404/405/409/413/422/500/503
- 路径继续保留 `.php` 后缀

## Android 不可破坏合同

### `GET /api/session.php`

认证：登录 Cookie，无 CSRF。

成功：

```json
{
  "code": 0,
  "data": {
    "user": {"id": 1, "username": "demo"},
    "csrf": "64位小写十六进制"
  }
}
```

未登录：HTTP 401。

### `GET /api/app_devices.php`

认证：Cookie。返回当前用户未撤销设备数组；不得出现 `token`、`token_hash`、`token_ciphertext`、推送 Token 原文/密文。

### `POST /api/app_devices.php` action=`register`

认证：Cookie + `X-CSRF-Token`。

请求：

```json
{
  "action": "register",
  "device_id": "UUID",
  "platform": "android",
  "name": "设备名",
  "app_version": "1.0.0"
}
```

成功：

```json
{
  "code": 0,
  "data": {
    "token": "64位小写十六进制",
    "device": {
      "id": 1,
      "device_id": "UUID",
      "platform": "android",
      "name": "设备名",
      "app_version": "1.0.0",
      "token_prefix": "前8位",
      "last_used_at": null,
      "last_seen_at": "YYYY-MM-DD HH:mm:ss",
      "created_at": "YYYY-MM-DD HH:mm:ss",
      "push_provider": null,
      "push_enabled": false,
      "push_last_success_at": null,
      "push_last_error": ""
    }
  }
}
```

行为：同一用户同一 UUID 未撤销时恢复相同 Token；撤销后重新注册生成不同 Token。

### `POST /api/app_devices.php` action=`revoke`

- 仅能撤销当前用户设备
- 撤销后旧 App Token 调用 ingest 必须立即 HTTP 401
- 重复撤销幂等返回成功

### `register_push`

供应商未配置时继续返回 HTTP 503：

```json
{"code":1,"message":"原生推送供应商尚未配置，未启用推送"}
```

不得伪报成功。

### `GET/POST /api/ingest.php`

认证优先级：`?k=`，然后 `Authorization: Bearer`。兼容 `api_tokens` 和未撤销 `app_devices`。

短信正文别名：`txt/text/message/sms/content`；发件人别名：`phone/sender/from`。兼容：

1. POST JSON
2. GET 查询参数
3. GET `txt` 请求头
4. POST `text/plain`
5. Bearer + JSON

关键 `status`：`created`、`duplicate`、`unauthorized`；响应字段和 HTTP 状态以旧仓库 `docs/API.md` 为准。

## Cookie 与 CSRF

- Cookie：Secure、HttpOnly、SameSite=Lax、Path=/、365 天
- SHA-256 查 `login_tokens.token_hash`
- 有效访问滑动延长 `expires_at` 和 Cookie
- CSRF：HMAC-SHA256，消息固定为 `pickup-csrf`，密钥为 Cookie 原文

## 加密兼容

```text
base64(IV[12] + TAG[16] + AES-256-GCM-CIPHERTEXT)
```

旧 `APP_KEY_HEX` 必须通过环境变量注入，不得复制到仓库。

## 包裹接口关键合同

- `GET /api/parcels.php?view=home`：仅 pending，含 station name/address、age_hours、来源消息和 AI 状态
- `GET /api/parcels.php?view=records&period=...&status=...`：即使没有 parcel 的来源消息也返回 `source_only`
- `POST mark_picked`：仅 pending → picked_up；不存在或状态变化返回 404
- `POST undo_picked`：仅 picked_up → pending；不存在或状态变化返回 404
- 所有操作限定当前用户

## 合同更新规则

迁移每个接口前：

1. 从 PHP 源码和旧 `docs/API.md` 提取请求/响应；
2. 用隔离测试账号录制脱敏真实响应；
3. 先写 Node 合同测试并确认 RED；
4. 实现至 GREEN；
5. PHP 与 Node 用同一语义夹具对比；
6. 在 `MIGRATION.md` 勾选。
