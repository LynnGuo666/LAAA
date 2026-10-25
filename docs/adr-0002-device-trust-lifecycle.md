# ADR-0002: 设备信任记忆的生命周期（登出保留、撤销即遗忘）

- **状态**：已接受（Accepted）
- **日期**：2026-10-22
- **关联**：ADR-0001、`known_devices`、`sessions`

## 背景

风控用 `device_token`（前端 localStorage 中的随机串）判断“是否新设备”。该记忆存放在
`known_devices`，与 `sessions` 的存活解耦，初衷是避免单设备用户每次登出后都被判为
新设备、反复强制两步验证（commit ed0f434）。

原实现只有写入与更新，**没有任何删除路径**：

- 登出、撤销会话、管理员强退都只动 `sessions` / `tokens`；
- `KNOWN_DEVICE` 注释与测试声称“用户主动忘记此设备时才删除”，但没有对应接口；
- 维护任务不清理该表。

结果是：设备一旦登录过，就永久保持“已知”身份。即使会话被撤销、设备被盗，
攻击者用同一浏览器重新登录也不会触发新设备风控——这正是“登出其他设备”最需要生效的场景。
数据库中也确实存在两台早已下线、仍被记忆的设备（最后活跃 2025-12 / 2026-02，活跃会话为 0）。

## 决策

按“动作语义”区分是否遗忘设备，而不是一刀切：

| 动作 | session | known_devices | 理由 |
|---|---|---|---|
| 普通登出 `POST /api/auth/logout` | 过期 | **保留** | 避免单设备用户陷入验证循环 |
| 用户撤销单个会话 `DELETE /api/user/sessions/{id}` | 删除 | **遗忘** | 用户明确表示不再信任该会话 |
| 登出其他设备 `POST /api/user/sessions/revoke-others` | 踢出 | **遗忘** | 安全动作，其他设备需重新验证 |
| 管理员强退单个/全部 `DELETE /api/admin/users/{id}/sessions...` | 踢出 | **遗忘** | 管理动作，等同于撤销信任 |
| 并发超限自动踢人（`reason=session_limit`） | 踢出 | **保留** | 只是腾会话名额，不代表设备失宠 |
| refresh token 重放检测 | 踢出 | **遗忘** | 疑似凭据被盗，必须降级信任 |
| 修改密码 | 全部会话删除 | **遗忘其他设备，保留当前设备** | 安全动作；保留当前设备避免改密后被锁在验证页 |
| 长期未活跃 | — | **180 天后清理** | 防止记忆无限堆积 |

配套实现：

1. 新增 `app/services/device_service.py`，集中 `list / forget / forget_for_sessions / forget_all`。
2. `SessionLimitService.kick_session(..., forget_trust=...)`：只有显式要求时才删记忆；
   `check_and_enforce_limit` 保持默认 `False`。
3. 新增接口：
   - `GET /api/user/devices`：列出已记住的设备（含无活跃会话者）；
   - `DELETE /api/user/devices/{id}`：忘记设备，同时吊销该设备上的全部会话。
4. `KNOWN_DEVICE_RETENTION_DAYS`（默认 180）由 `maintenance_service` 按 `last_seen` 滚动清理。
5. 前端安全页新增“已记住的设备”区域；忘记当前设备后轮换 `laaa_device_token` 并退出登录，
   避免同一浏览器下次登录立即把设备写回记忆。

## 后果

**正面**

- “撤销会话 / 登出其他设备”现在真正撤销了设备信任，被盗设备重新登录会触发新设备验证。
- 设备记忆有了可见、可管理的入口，也能自动过期，不再无限堆积。
- 普通登出与并发踢人的体验保持不变（不引入验证循环）。

**取舍**

- 撤销会话后，该设备下次登录需要完成一次验证（邮箱验证码 / TOTP / Passkey）。
- 若环境的 SMTP 未配置且用户没有 TOTP/Passkey，撤销设备后可能无法完成验证；
  因此“改密”只遗忘其他设备，保留当前设备作为兜底。
- `sessions.is_trusted`（界面上的“信任/取消信任”）仍然是展示字段，不参与风控；
  真正的信任语义以 `known_devices` 为准。后续可考虑移除该字段或接入风控。

## 未纳入本次范围

- 成功登录日志双写（`create_tokens` 与 `_finalize_login` 各写一条）。
- SQLite 外键未启用（`PRAGMA foreign_keys=ON` 未设置）。
- 过期 `sessions` / `verification_sessions` 无清理。
- `sessions.is_trusted` 与真实风控脱节。
