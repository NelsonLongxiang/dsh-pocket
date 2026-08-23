// dsh-pocket 网页客户端：
//   1. 设置页签「手机访问」（局域网/公网二维码 + 更新/重启提示）
//   2. 移动端适配（移植自 MIT 项目 dsh-web-mobile，见 client/mobile/LICENSE.dsh-web-mobile）
//
// 手机扫码打开的就是电脑上的 dsh web，实时同步；窄屏自动变成抽屉布局。
//
// 注：Web Push 已移除——浏览器推送依赖 Google FCM（Chrome）等境外服务，
// 国内直连被墙，普通用户用不了。专注扫码同屏这一件事。

import { createElement as h, useEffect, useState } from 'react';

import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS, redactStatus, compareVersions } from './api.js';
import { mobileApply } from './mobile/mobile-apply.tsx';

const name = 'dsh-pocket';
const inject = ['slots', 'connection', 'layout', 'locale', 'sessionLogDownload'];

// 官方 DeepSeek Harness 设计系统（dsh-client-ui-theme design-platform.css）：
// 按钮 md=36px 胶囊形 / sm=28px；品牌色 --dsw-alias-brand-primary；
// hover 走 --dsw-alias-button-*-hover；间距 4px 栅格；正文 13px。
const styles = {
  card: { background: 'var(--dsw-alias-bg-layer-1,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', borderRadius: 12, padding: '16px 20px', maxWidth: 480 },
  block: { borderTop: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', marginTop: 16, paddingTop: 16 },
  muted: { color: 'var(--dsw-alias-label-tertiary,#8b93a1)', fontSize: 12, lineHeight: 1.5 },
  code: { fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, wordBreak: 'break-all', margin: '6px 0 10px', color: 'var(--dsw-alias-label-primary,inherit)' },
  // 主按钮：官方 md 胶囊形（36px）
  primary: { font: 'inherit', cursor: 'pointer', border: 'none', background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))', color: 'var(--dsw-alias-label-primary-foreground, #fff)', height: 36, padding: '0 16px', borderRadius: 999, fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  // 次级按钮：官方 outline/ghost 胶囊形
  btn: { font: 'inherit', cursor: 'pointer', border: '1px solid var(--dsw-alias-button-ghost-active-border, var(--dsw-alias-border-l2,#d1d5db))', background: 'var(--dsw-alias-bg-layer-1,#fff)', color: 'var(--dsw-alias-label-primary,inherit)', height: 36, padding: '0 16px', borderRadius: 999, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  qr: { width: 220, height: 220, borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', margin: '8px 0' },
  warn: { color: 'var(--dsw-alias-state-warn-primary,#b45309)', fontSize: 12, lineHeight: 1.5 },
  input: { font: 'inherit', fontSize: 13, padding: '8px 10px', border: '1px solid var(--dsw-alias-border-l2,#d1d5db)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1,#fff)', color: 'var(--dsw-alias-label-primary,inherit)', width: '100%', boxSizing: 'border-box' },
};

function PocketSettingsTab({ rpcCall }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [tunnelState, setTunnelState] = useState(null); // 隧道进度 {phase, detail, startedAt}
  const [restartNotice, setRestartNotice] = useState(false); // 重启后提示
  const [updateInfo, setUpdateInfo] = useState(null); // { current, latest, updating, result, startedAt } | null
  const [isDesktop, setIsDesktop] = useState(false); // DSH Desktop（Electron）环境：更新/重启由桌面版管理
  const [now, setNow] = useState(Date.now()); // 每秒 tick，驱动倒计时

  // 进行中操作的「已等待 X 秒」倒计时
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = (startedAt) => (startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0);

  const call = async (endpoint, payload) => {
    const res = await rpcCall(endpoint, payload);
    if (!res?.ok) throw new Error(res?.error?.message ?? 'RPC failed');
    return res.value;
  };

  const load = async () => {
    try {
      const s = await call(POCKET_ENDPOINTS.status, {});
      setStatus(s);
      setTunnelState(s.tunnelState ?? null);
      if (s.desktop) setIsDesktop(true);
      if (s.restartNotice) {
        // 新进程确认起来了：显示一次「已重启」，清掉旧的更新横幅（单状态，不并存），
        // 然后自动刷新页面加载新代码——不用用户手动刷新
        setRestartNotice(true);
        setUpdateInfo(null);
        if (!sessionStorage.getItem('dshp-auto-reloaded')) {
          sessionStorage.setItem('dshp-auto-reloaded', '1');
          setTimeout(() => { try { location.reload(); } catch { /* 忽略 */ } }, 2000);
        }
      }
    } catch { /* 忽略瞬时失败 */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  // 每次页面加载清掉自动刷新标记——这样下次重启（更新后）才能再次触发自动刷新
  useEffect(() => {
    try { sessionStorage.removeItem('dshp-auto-reloaded'); } catch { /* 忽略 */ }
  }, []);

  // 版本检测：host 当前版本 vs npm registry latest（registry 带 CORS *）
  // 两种情况显示横幅：① 有新版可更新；② 磁盘已更新但进程还是旧代码（重启生效）
  // cache: 'no-store' —— registry 响应带缓存头，浏览器会缓存旧版本号导致「小版本不提示」
  // 周期重查（每 5 分钟）：npm registry 的 /latest 走 CDN 边缘缓存，刚发布后打开页面
  // 可能拿到旧版本号——周期性重查让更新提示在缓存刷新后自动出现，不用重开页面。
  // 桌面端（isDesktop）：更新/重启由 DSH Desktop 管理，这里不做版本检测、不显示更新横幅
  useEffect(() => {
    if (isDesktop) return;
    let alive = true;
    const check = async () => {
      try {
        const v = await call(POCKET_ENDPOINTS.version, {});
        const meta = await (await fetch('https://registry.npmjs.org/dsh-pocket/latest', { cache: 'no-store' })).json();
        if (!alive) return;
        const latest = typeof meta?.version === 'string' ? meta.version : null;
        if (latest && v.current && compareVersions(latest, v.current) > 0) {
          setUpdateInfo({ current: v.current, latest, updating: false, result: null });
        } else if (v.current && v.loaded && compareVersions(v.current, v.loaded) > 0) {
          // 已更新未重启：显示「已更新，重启生效」+ 重启按钮
          setUpdateInfo({ current: v.current, latest: v.current, updating: false, result: 'ok', updated: true });
        }
      } catch { /* 网络失败静默 */ }
    };
    check();
    const t = setInterval(check, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [isDesktop]);

  // 重启宿主（更新生效必需：刷新页面不会重载服务端代码）
  const restartPocket = async () => {
    setUpdateInfo((u) => ({ ...u, restarting: true, startedAt: Date.now() }));
    try {
      // 宿主 500ms 后自杀，RPC 响应可能来不及送达 → 3 秒超时兜底，别让按钮永远卡「重启中…」
      await Promise.race([
        call(POCKET_ENDPOINTS.restart, {}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('restart requested (no reply within 3s)')), 3000)),
      ]);
      setUpdateInfo((u) => ({ ...u, restarting: true, result: 'ok' }));
    } catch (err) {
      // 网络断连/超时同样视为「已请求重启」——旧进程即将退出，等新进程起来后刷新即可
      const msg = String(err?.message ?? '');
      if (/connection|socket|fetch|network|abort|cancelled|ECONN|disconnect|closed|timeout/i.test(msg)) {
        setUpdateInfo((u) => ({ ...u, restarting: true, result: 'ok' }));
        return;
      }
      setUpdateInfo((u) => ({ ...u, restarting: false, result: 'fail', output: err.message }));
    }
  };

  // 一键更新：调宿主 dsh plugin update（成功后宿主自动重启生效，用户只点一次）
  const runUpdate = async () => {
    setUpdateInfo((u) => ({ ...u, updating: true, result: null, startedAt: Date.now() }));
    try {
      const r = await call(POCKET_ENDPOINTS.update, {});
      setUpdateInfo((u) => ({
        ...u,
        updating: false,
        result: r.ok ? 'ok' : 'fail',
        autoRestart: r.autoRestart === true,
        output: r.output ?? r.error,
      }));
    } catch (err) {
      setUpdateInfo((u) => ({ ...u, updating: false, result: 'fail', output: err.message }));
    }
  };

  const startTunnel = async () => {
    setBusy(true);
    setError(null);
    setTunnelState({ phase: 'starting', detail: '正在开启…', startedAt: Date.now() });
    try {
      setStatus(await call(POCKET_ENDPOINTS.tunnelStart, {}));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const stopTunnel = async () => {
    try { setStatus(await call(POCKET_ENDPOINTS.tunnelStop, {})); } catch { /* 忽略 */ }
  };

  // 刷新局域网访问密码（旧密码立即作废）
  const refreshLanPin = async () => {
    try {
      const r = await call(POCKET_ENDPOINTS.lanTokenRefresh, {});
      setStatus((s) => ({ ...s, lanToken: r.lanToken }));
    } catch { /* 忽略 */ }
  };

  // 局域网访问密码开关（issue #24）：默认开启；关闭后局域网扫码直连（公网不受影响）
  const setLanAuth = async (on) => {
    try {
      const r = await call(POCKET_ENDPOINTS.lanAuthSetEnabled, { on });
      setStatus((s) => ({ ...s, lanAuthEnabled: r.lanAuthEnabled }));
    } catch { /* 忽略 */ }
  };

  const lanUrl = status?.lanUrl;
  const tunnelUrl = status?.tunnelUrl;
  const tunnelPhase = tunnelState?.phase ?? 'idle';
  const tunnelStarting = ['downloading', 'starting', 'registering'].includes(tunnelPhase);
  const tunnelStateDetail = tunnelState?.detail ?? '';
  const tunnelStateStarted = tunnelState?.startedAt ?? null;

  return h('div', { style: styles.card },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
      h('div', null,
        h('strong', null, '📱 手机访问 | Phone access'),
        h('div', { style: styles.muted }, '手机扫码打开的就是电脑上的这个界面，实时同步 | the phone shows this exact screen, live'),
      ),
      h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary,#8b93a1)', textAlign: 'right' } },
        h('div', { style: { whiteSpace: 'nowrap' } }, '开发者：程序员少北晨'),
        h('div', { style: { whiteSpace: 'nowrap' } }, '⭐ 顺手留颗 Star，作者能高兴一整天'),
        h('a', { href: 'https://github.com/shaobeichen/dsh-pocket', target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-brand-primary,#4f6ef7)', fontSize: 12, lineHeight: 1.6, textDecoration: 'underline' } },
          '行，给你一颗 Star'),
      ),
    ),

    // 桌面端不显示更新/重启横幅（更新由 DSH Desktop 管理），也不需要额外提示

    // 重启后提示（进程在后台运行，停止方法）——左侧蓝色色条（桌面端不会触发本插件的自重启）
    !isDesktop && restartNotice ? h('div', { style: { ...styles.block, borderLeft: '4px solid var(--dsw-alias-brand-primary,#4f6ef7)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2,#f3f4f6)', padding: '10px 12px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('div', { style: { fontWeight: 600, fontSize: 13 } }, '🔄 已重启 | Restarted'),
        h('button', { style: styles.btn, onClick: () => setRestartNotice(false) }, '知道了 | OK'),
      ),
      h('div', { style: styles.muted, marginTop: 4, wordBreak: 'break-all' }, `进程在后台运行（不挂终端）。如需停止：${status?.killHint ?? `lsof -ti :${status?.dshPort ?? 3080} | xargs kill -9`}`),
    ) : null,

    // 更新提示——左侧黄色色条（提示有新版本）；单状态：有更新/更新中/已更新自动重启，不并存
    // 桌面端不渲染（更新由 DSH Desktop 管理）
    !isDesktop && updateInfo ? h('div', { style: { ...styles.block, borderLeft: '4px solid var(--dsw-alias-state-warn-primary,#b45309)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2,#f3f4f6)', padding: '10px 12px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('div', { style: { fontWeight: 600, fontSize: 13 } },
          updateInfo.updated
            ? `✅ 已更新 v${updateInfo.current}，重启生效 | Updated — restart to apply`
            : updateInfo.result === 'ok'
              ? (updateInfo.autoRestart ? `✅ 已更新 v${updateInfo.latest}，正在自动重启… | updated — restarting…` : `✅ 已更新 v${updateInfo.latest} | Updated`)
              : `📦 新版本 v${updateInfo.latest} | Update available`),
        updateInfo.result !== 'ok'
          ? h('button', { style: styles.primary, onClick: runUpdate, disabled: updateInfo.updating }, updateInfo.updating ? '更新中…' : `更新到 v${updateInfo.latest} | Update`)
          : updateInfo.autoRestart
            ? h('button', { style: styles.btn, disabled: true }, '正在重启生效… | restarting…')
            : h('button', { style: styles.primary, onClick: restartPocket, disabled: updateInfo.restarting }, updateInfo.restarting ? '重启中…' : '🔄 重启 dsh web 生效 | Restart now'),
      ),
      h('div', { style: styles.muted, marginTop: 4 },
        updateInfo.updating
          ? `⏳ 更新中（通常 1-2 分钟）· 已等待 ${elapsed(updateInfo.startedAt)} 秒 | updating (usually 1-2 min) · ${elapsed(updateInfo.startedAt)}s`
        : updateInfo.restarting
          ? `⏳ 正在重启生效（通常 10-30 秒）· 已等待 ${elapsed(updateInfo.startedAt)} 秒 | restarting (usually 10-30s) · ${elapsed(updateInfo.startedAt)}s`
        : updateInfo.result === 'ok'
          ? (updateInfo.autoRestart ? '✅ 已更新，正在自动重启生效，请稍候刷新 | updated — restarting automatically, refresh shortly'
            : '✅ 已更新，重启 dsh web 生效 | updated — restart dsh web')
        : updateInfo.result === 'fail' ? `❌ 失败：${updateInfo.output || '未知'}（手动更新：dsh plugin --profile web update dsh-pocket --latest -w）`
        : `当前 v${updateInfo.current} → 最新 v${updateInfo.latest}`),
    ) : null,

    // 局域网
    h('div', { style: styles.block },
      h('div', { style: { fontWeight: 600, fontSize: 13 } }, '📶 局域网（同一 WiFi）| LAN'),
      lanUrl
        ? h('div', null,
          h('img', { src: status.lanQr, alt: 'LAN QR', style: styles.qr }),
          h('div', { style: styles.code }, lanUrl),
          h('div', { style: styles.muted }, '手机连接同一 WiFi 后扫码即可打开'),
          // 访问密码开关（issue #24）：默认开启；关闭后扫码直连（仅同一局域网设备可访问）
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)' } }, '局域网访问密码 | LAN access PIN'),
            h('button', {
              style: { ...styles.btn, height: 28, padding: '0 12px', fontSize: 12, fontWeight: status?.lanAuthEnabled !== false ? 600 : 400, background: status?.lanAuthEnabled !== false ? 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))' : 'var(--dsw-alias-bg-layer-1,#fff)', color: status?.lanAuthEnabled !== false ? 'var(--dsw-alias-label-primary-foreground, #fff)' : 'var(--dsw-alias-label-primary,inherit)' },
              onClick: () => setLanAuth(true),
            }, '开 | On'),
            h('button', {
              style: { ...styles.btn, height: 28, padding: '0 12px', fontSize: 12, fontWeight: status?.lanAuthEnabled === false ? 600 : 400, background: status?.lanAuthEnabled === false ? 'var(--dsw-alias-state-error-primary,#dc2626)' : 'var(--dsw-alias-bg-layer-1,#fff)', color: status?.lanAuthEnabled === false ? '#fff' : 'var(--dsw-alias-label-primary,inherit)' },
              onClick: () => setLanAuth(false),
            }, '关 | Off'),
          ),
          status?.lanAuthEnabled !== false
            ? h('div', { style: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)', lineHeight: 1.5 } },
              '🔐 访问密码：',
              status.lanToken,
              '（手机打开需输入；与公网密码分开）',
              h('button', { style: { ...styles.btn, height: 26, padding: '0 10px', fontSize: 12, marginLeft: 8 }, onClick: refreshLanPin }, '刷新 | Refresh'),
            )
            : h('div', { style: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-state-warn-primary,#b45309)', lineHeight: 1.5 } },
              '🔓 密码已关闭：扫码直连，无需密码（仅同一局域网设备可访问；公网仍要密码）| PIN off — scan & go (LAN only; public still requires PIN)'),
        )
        : h('div', { style: styles.muted }, '代理未就绪… | proxy starting…'),
    ),

    // 公网
    h('div', { style: styles.block },
      h('div', { style: { fontWeight: 600, fontSize: 13 } }, '🌐 公网（人在外面）| Anywhere'),
      tunnelUrl
        ? h('div', null,
          h('img', { src: status.tunnelQr, alt: 'Tunnel QR', style: styles.qr }),
          h('div', { style: styles.code }, tunnelUrl),
          h('div', { style: styles.muted }, '任何网络扫码即用（URL 每次重启自动换新）'),
          status.accessToken
            ? h('div', { style: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)', lineHeight: 1.5 } },
              `🔐 访问密码：${status.accessToken}（每次开启公网变新；手机打开链接需输入此密码）| PIN: ${status.accessToken} — required on the phone`)
            : null,
          h('button', { style: styles.btn, onClick: stopTunnel }, '关闭公网 | Stop'),
        )
        : h('div', null,
          h('button', { style: { ...styles.primary, margin: '8px 0' }, onClick: startTunnel, disabled: busy || tunnelStarting }, busy ? '开启中…' : '开启公网访问 | Enable anywhere'),
          tunnelStarting
            ? h('div', { style: { marginTop: 4, fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)' } },
              tunnelPhase === 'downloading'
                ? `⏳ 下载 cloudflared（首次约 20-50MB，通常 1-2 分钟；之后秒开）· 已等待 ${elapsed(tunnelStateStarted)} 秒`
                : `⏳ 连接 Cloudflare 边缘（通常 5-30 秒）· 已等待 ${elapsed(tunnelStateStarted)} 秒${elapsed(tunnelStateStarted) > 30 ? ' — 有点久？检查是否开着代理/VPN（Clash TUN 等）' : ''}`)
            : tunnelPhase === 'error'
              ? h('div', { style: { marginTop: 4, fontSize: 12, color: 'var(--dsw-alias-state-error-primary,#dc2626)' } },
                `❌ 开启失败：${tunnelStateDetail || '未知错误 | failed'}（可重试；若是代理/VPN 问题见 README 排障）`)
              : null,
        ),
    ),

    error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary,#dc2626)', fontSize: 12, marginTop: 8 } }, `❌ ${error}`) : null,

    // 页面最底部：反馈入口
    h('div', { style: { ...styles.block, textAlign: 'center' } },
      h('a', { href: 'https://github.com/shaobeichen/dsh-pocket/issues', target: '_blank', rel: 'noreferrer', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#6b7280)', textDecoration: 'none' } },
        '有问题？欢迎到 GitHub Issues 反馈 🙏 | Questions? Open an issue on GitHub'),
    ),
  );
}

// 模型管理（LAN 全功能）：核心「模型」页的客户端按页面 hostname 判定 loopback，
// 经 pocket 代理打开的远程页面被它判为不可用；而代理已把 RPC 通道洗成 loopback，
// 服务端全通。这里直接用 connection.api 调配置面 RPC（契约与核心模型页一致），
// 让手机/LAN 也能配 provider、存 API key、添加自定义 provider。
// 安全边界：公网隧道流量在代理层被拦（lib/proxy.mjs tunnelRpcGuard）——模型管理仅限局域网。
const LLm_NS_FILTER = (ns) => typeof ns === 'string' && ns.startsWith('llm-');

/** 模型约定引用名（与核心 deriveKeyRef 一致）：provider 大写、非字母数字转下划线。 */
function deriveKeyRef(provider) {
  return provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY';
}

/** RpcResponse 信封解包：{ rpcId, result: { ok, value | error } } → value 或 throw。 */
async function unwrap(promise, what) {
  const res = await promise;
  if (!res?.result?.ok) throw new Error(res?.result?.error?.message ?? what + ' failed');
  return res.result.value;
}

function ModelsManagerTab({ api }) {
  const [data, setData] = useState(null); // { providers, namespaces, writable, credentials }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // 操作结果提示
  const [editing, setEditing] = useState(null); // { provider, keyDraft, baseURL }
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setBusy(true); setError(null);
    try {
      const [directory, settingsDoc] = await Promise.all([
        unwrap(api.llm.providers({}), 'llm.providers'),
        unwrap(api.settings.describe({}), 'settings.describe'),
      ]);
      const providers = directory.providers ?? [];
      const llmNamespaces = (settingsDoc.namespaces ?? []).filter((n) => LLm_NS_FILTER(n.ns));
      const nsByNs = new Map(llmNamespaces.map((n) => [n.ns, n]));
      // 收集 key 引用：目录各 provider 的 apiKeyEnv（配置里的）或约定名
      const refs = [...new Set(providers.map((p) => {
        const ns = nsByNs.get(p.settingsNs);
        const profile = p.settingsPath.length === 0
          ? ns?.value
          : ns?.value?.providers?.[p.provider];
        return profile?.apiKeyEnv ?? (p.settingsPath.length > 0 ? deriveKeyRef(p.provider) : null);
      }).filter(Boolean))];
      let credentials = {};
      if (refs.length > 0) {
        try {
          const cred = await unwrap(api.credentials.describe({ refs }), 'credentials.describe');
          credentials = cred.credentials ?? {};
        } catch { /* key 状态是增强信息，失败不阻塞目录 */ }
      }
      setData({ providers, namespaces: nsByNs, writable: settingsDoc.writable !== false, credentials });
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []);

  /** 保存一个 provider 的编辑：key（若有输入）→ credentials.set；baseURL → settings.mutate。 */
  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true); setNotice(null);
    try {
      const entry = data.providers.find((p) => p.provider === editing.provider);
      const ns = data.namespaces.get(entry.settingsNs);
      const revision = ns?.revision ?? 0;
      const key = editing.keyDraft.trim();
      if (key.length > 0) {
        const ref = deriveKeyRef(editing.provider);
        await unwrap(api.credentials.set({ ref, value: key }), 'credentials.set');
        // 确保配置引用了这个约定名（官方 ns 的 profile 可能没写 apiKeyEnv）
        if (entry.settingsPath.length === 0 && ns?.value?.apiKeyEnv !== ref) {
          await unwrap(api.settings.mutate({
            ns: entry.settingsNs,
            ops: [{ op: 'set', path: ['apiKeyEnv'], value: ref }],
            expectedRevision: revision,
          }), 'settings.mutate');
        }
      }
      if (editing.baseURL !== undefined && editing.baseURL.trim() !== '') {
        const base = entry.settingsPath.length === 0 ? [] : entry.settingsPath;
        await unwrap(api.settings.mutate({
          ns: entry.settingsNs,
          ops: [{ op: 'set', path: [...base, 'baseURL'], value: editing.baseURL.trim() }],
          expectedRevision: revision,
        }), 'settings.mutate');
      }
      setNotice('✅ 已保存 ' + editing.provider);
      setEditing(null);
      await load();
    } catch (err) {
      setNotice('❌ ' + (err?.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  };

  /** 删除自定义 provider 配置（仅 user 层有的；官方 provider 不允许删）。 */
  const removeProvider = async (entry) => {
    setBusy(true); setNotice(null);
    try {
      const ns = data.namespaces.get(entry.settingsNs);
      if (!ns?.user || entry.settingsPath.length === 0) throw new Error('仅自定义 provider 可删除');
      await unwrap(api.settings.mutate({
        ns: entry.settingsNs,
        ops: [{ op: 'unset', path: entry.settingsPath }],
        expectedRevision: ns.revision ?? 0,
      }), 'settings.mutate');
      setNotice('🗑️ 已删除 ' + entry.provider);
      await load();
    } catch (err) {
      setNotice('❌ ' + (err?.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  };

  const rowOf = (entry) => {
    const ns = data.namespaces.get(entry.settingsNs);
    const profile = entry.settingsPath.length === 0 ? ns?.value : ns?.value?.providers?.[entry.provider];
    const keyRef = profile?.apiKeyEnv ?? (entry.settingsPath.length > 0 ? deriveKeyRef(entry.provider) : null);
    const cred = keyRef ? data.credentials[keyRef] : null;
    const custom = entry.declared === true || entry.settingsPath.length > 0;
    const open = editing?.provider === entry.provider;
    return h('div', {
      key: entry.provider,
      style: { padding: '10px 0', borderTop: '1px solid var(--dsw-alias-border-l2,#e5e7eb)' },
    },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
        h('span', {
          title: entry.active ? '启用中 | active' : '未启用 | inactive',
          style: { color: entry.active ? 'var(--dsw-alias-state-success-primary,#16a34a)' : 'var(--dsw-alias-label-tertiary,#8b93a1)', fontSize: 11 },
        }, '●'),
        h('span', { style: { fontWeight: 500 } }, entry.displayName),
        custom ? h('span', { style: { ...styles.muted, border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', borderRadius: 999, padding: '1px 8px', fontSize: 11 } }, '自定义 | Custom') : null,
        h('span', { style: styles.muted }, entry.provider),
        h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
          h('button', {
            style: { ...styles.btn, height: 26, padding: '0 10px', fontSize: 12 },
            onClick: () => { setAdding(false); setEditing(open ? null : { provider: entry.provider, keyDraft: '', baseURL: profile?.baseURL ?? '' }); },
          }, open ? '收起' : '编辑'),
          custom && data.writable ? h('button', {
            style: { ...styles.btn, height: 26, padding: '0 10px', fontSize: 12, color: 'var(--dsw-alias-state-error-primary,#dc2626)' },
            disabled: busy,
            onClick: () => { void removeProvider(entry); },
          }, '删除') : null,
        ),
      ),
      h('div', { style: { ...styles.muted, marginTop: 3 } },
        keyRef ? (cred?.configured === true ? '🔑 API 密钥已配置' : '🔑 API 密钥未配置') : '此提供方无需密钥',
        profile?.baseURL ? ' · ' + profile.baseURL : '',
      ),
      open ? h('div', { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 } },
        keyRef || entry.settingsPath.length === 0 ? h('label', { style: { fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 } },
          'API 密钥（留空保持不变）| API key',
          h('input', {
            type: 'password',
            value: editing.keyDraft,
            placeholder: cred?.configured === true ? '已配置——输入新值可替换' : '输入 API 密钥',
            style: styles.input,
            onChange: (e) => setEditing({ ...editing, keyDraft: e.target.value }),
          }),
        ) : null,
        h('label', { style: { fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 } },
          'API 地址（留空保持不变）| Base URL',
          h('input', {
            value: editing.baseURL,
            placeholder: 'https://api.example.com/v1',
            style: styles.input,
            onChange: (e) => setEditing({ ...editing, baseURL: e.target.value }),
          }),
        ),
        h('div', null,
          h('button', { style: styles.primary, disabled: busy || !data.writable, onClick: () => { void saveEdit(); } },
            busy ? '保存中…' : '保存 | Save'),
        ),
      ) : null,
    );
  };

  return h('div', { style: styles.card },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
      h('strong', null, '🤖 模型管理 | Models'),
      h('button', { style: { ...styles.btn, height: 28, padding: '0 12px', fontSize: 12 }, onClick: load, disabled: busy },
        busy ? '加载中…' : '刷新 | Refresh'),
    ),
    h('div', { style: { ...styles.muted, marginTop: 4 } },
      data && data.writable === false ? '⚠️ 当前部署设置只读，仅可查看' : '在手机上配置提供方、API 密钥与地址（仅局域网可用）'),

    notice ? h('div', { style: { fontSize: 12, marginTop: 8, wordBreak: 'break-all' } }, notice) : null,
    error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary,#dc2626)', fontSize: 12, marginTop: 10 } }, '❌ ' + error) : null,

    data === null && !error ? h('div', { style: { ...styles.muted, marginTop: 10 } }, '加载中… | loading…') : null,
    data ? h('div', { style: { marginTop: 10 } },
      data.providers.length === 0
        ? h('div', { style: styles.muted }, '暂无提供方')
        : data.providers.map(rowOf),
    ) : null,
  );
}

export function apply(ctx) {
  // 移动端适配（dsh-web-mobile 移植）：抽屉布局/触控/安全区，仅窄屏生效
  mobileApply(ctx);

  const rpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(POCKET_RPC_CHANNEL, endpoint, payload, signal);

  // 设置一级入口（与 通用设置/模型/插件 同级，order 1 = 通用之后、最外层）
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'pocket',
        order: 1,
        label: () => '手机访问',
        inject: () => ({ rpcCall }),
      },
      PocketSettingsTab,
    ),
  );

  // 提供方目录：只读、任何访问方式可用（局域网/公网代理下核心「模型」页的
  // 设置读取不可达，这里是远程唯一能看到目录的地方）
  const api = ctx.connection.api;
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'pocket-models',
        order: 2,
        label: () => '模型管理',
        inject: () => ({ api }),
      },
      ModelsManagerTab,
    ),
  );
}

export { name, inject, redactStatus };
