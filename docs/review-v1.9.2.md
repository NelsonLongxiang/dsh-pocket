# dsh-pocket v1.9.2 代码质量审查与范式判定（2026-08-22）

审查基线：main@4cdd3ec；端口变更分支 chore/v0.3.0-port-13080@b984fad（PR #1）。

## 一、范式判定（plugin-dev-paradigm 决策树）

**结论：合法 bundle 插件，形态保持不变。**

- Q2 命中：GUI 小组件（手机访问面板）嵌在 DSH 会话界面 → client slot 路线。
- 挂载点七项中命中五项：client slot UI、host 服务行、HTTP 代理面、生命周期（隧道守护）、持久化（settings.json）。无可抽纯核——proxy/tunnel/service 全部带副作用与状态，抽"库"只会把 ctx 从中间层漏出去。
- bin/dsh-pocket.mjs 与插件体关系：同一包的独立 CLI 入口（无插件环境时手动拉代理），与插件共享 lib/proxy+lib/tunnel 实现——**这是正确的单包双入口形态**，不是造轮子；拆成独立仓反而制造双源漂移。
- 禁改库引用式重构确认：bundle 形态是硬约束，本报告所有优化不改变形态。

## 二、代码质量审查

### 安全面
1. 【建议修】PIN 比较非 timing-safe（proxy.mjs:121,123,160 三处 `===` 直比）：8 位数字熵低，LAN 内可计时侧信道逐位猜解。修法 `crypto.timingSafeEqual`（等长转 Buffer 后比对），三处同修。
2. 【建议修】query token 回退面（?token= 认证通过）：token 会进 server access log 与浏览器历史。HttpOnly cookie 已是主通道，query 回退仅服务扫码首跳——建议登录种 cookie 后 302 到无参 URL 并在文档标注该残留面。
3. 【已合规】cookie HttpOnly+SameSite=Lax；公网强制 PIN、LAN 可关（默认开）；静态资源路径 normalize 防穿越；upstream 改写只动 Host/Origin 头 + 固定标记 polyfill 注入（data-dsh-pocket-*），无任意 HTML 注入点。

### 错误处理与日志
4. 【合规】tunnel.mjs 24 处 catch、多源下载降级重试（issue #22 场景）；settings.mjs 损坏文件降级默认值不阻断。
5. 【建议】writeSettings 的空 catch 吞写失败（settings.mjs:24）——磁盘满时用户以为已关闭 LAN 密码实际未生效，建议至少 logger.warn。

### 结构与重复
6. 【合规】bin 入口与服务共享 createPocketProxy 单实现，无双源；settings 模块唯一读写方在 index.js，无重复持久化逻辑。
7. 【观察】proxy.mjs(19KB)/tunnel.mjs(19KB) 均超普通单文件体量但内聚（协议处理/多源下载各自成域），本期不拆。

### 测试
8. 【事实】4 个 fail 为 main@4cdd3ec 基线预存（网络依赖：cloudflared 下载、隧道恢复断言、真实链路 smoke），非本次端口变更引入。建议后续单独开卡修复测试环境依赖（mock cloudflared 二进制/本地回环隧道）。

## 三、优化实施

已完成（PR #1 @ b984fad）：默认代理端口 3081→13080 共 10 处（bin 4/lib 6），dsh web 3080 引用零触碰，显式 --port 仍优先。

## 四、遗留建议（不在本期）

- P2: PIN timingSafeEqual 三处替换（一行级×3）
- P3: writeSettings 写失败告警
- P3: query token 登录后 302 清参
- P2: 4 个预存测试失败的环境依赖治理
