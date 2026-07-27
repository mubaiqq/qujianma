# 快递公司识别故障层隔离（admin 209–213，只读）

## 结论

1. **模型 prompt 问题已复现**：active provider 在当前规则下把驿站/地址实体误填为 `courier_name`（209 菜鸟驿站、210 欢猫驿站、212 妈妈驿站）；临时增强“人名/驿站/地址品牌不等于承运商”后 5/5 留空，符合预期。
2. **校验器问题已复现**：PHP 与 Node 都接受无承运商证据的人名；并会把地址里的“韵达超市/圆通速递”主动升级为承运商。纯函数红测均为 4/5 失败，仅无任何相关词的 211 通过。
3. **图片路由绕过校验**：两端图片流程都先校验临时副本，但随后持久化原始 item。Node `service.ts` 调用 `validatePickupResult(item, ocr, [])` 后仍传 `item` 给 `createImageMessage/persist`；PHP 虽拷贝部分 validated 字段，但校验器本身会保留有 OCR 字面证据的人名，并错误吸收地址品牌。
4. **字段映射不是主因**：209/213 的模型 JSON、parse JSON、parcel `courier_name` 一致为同一人名，说明错误值沿映射原样传播；没有 courier/station 列互换证据。

## 可重复命令

```bash
# 纯函数红测（预期当前退出 1）
php tests/regression/courier-php-replay.php
npx tsx tests/regression/courier-node-replay.ts

# 安全 AI 重放：先 SHOW GRANTS 证明只读，只 SELECT active provider；不写库、不打印 key
npx tsx tests/regression/courier-ai-replay.ts
```

## 安全边界

- fixture 基于 209–213 脱敏 OCR，取件码替换为合成码；无完整真实码。
- AI 输出落盘不含 key，文件权限 0600。
- 数据库脚本检测到写权限即拒绝运行；本次账号仅只读。
- 未修改生产数据或生产代码。
