// 端口选择方案测试：默认 = dsh web 端口 + 10000；配置/注入优先；非法退回 13080。
// 移植自 feat/derive-pocket-port@e437996，适配 2.8.0 基线新增 settingsPort（settings.json proxyPort）层级。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaultPocketPort } from '../lib/service.mjs';
import { resolvePocketPort } from '../lib/index.js';

test('defaultPocketPort: 从 dsh web 端口推导（+10000）', () => {
  assert.equal(defaultPocketPort(3080), 13080);
  assert.equal(defaultPocketPort(3082), 13082);
  assert.equal(defaultPocketPort(3081), 13081);
});

test('defaultPocketPort: 非法 dshPort 退回固定 13080', () => {
  assert.equal(defaultPocketPort(undefined), 13080);
  assert.equal(defaultPocketPort(0), 13080);
  assert.equal(defaultPocketPort(-5), 13080);
  assert.equal(defaultPocketPort('abc'), 13080);
  assert.equal(defaultPocketPort(20000), 13080); // 推导结果会撞自身端口区间，退回
});

test('resolvePocketPort: settings.proxyPort 优先于推导（issue #70 配置生效）', () => {
  assert.equal(resolvePocketPort({ settingsPort: 13080, dshPort: 3080 }), 13080);
  assert.equal(resolvePocketPort({ settingsPort: 14000, dshPort: 3082 }), 14000);
});

test('resolvePocketPort: 配置优先于 settings.proxyPort 与推导（config.port 覆盖默认）', () => {
  assert.equal(resolvePocketPort({ configPort: 14000, settingsPort: 15000, dshPort: 3080 }), 14000);
});

test('resolvePocketPort: internals.port 注入优先于一切配置', () => {
  assert.equal(resolvePocketPort({ internalsPort: 15000, configPort: 14000, settingsPort: 13080, dshPort: 3080 }), 15000);
});

test('resolvePocketPort: 无配置时按 dshPort 推导（生产/测试不再同抢 13080）', () => {
  assert.equal(resolvePocketPort({ dshPort: 3080 }), 13080);
  assert.equal(resolvePocketPort({ dshPort: 3082 }), 13082);
  assert.notEqual(resolvePocketPort({ dshPort: 3080 }), resolvePocketPort({ dshPort: 3082 }));
});

test('resolvePocketPort: 非法配置值（0/负数/非整数）不覆盖默认推导', () => {
  assert.equal(resolvePocketPort({ configPort: 0, dshPort: 3082 }), 13082);
  assert.equal(resolvePocketPort({ configPort: -1, dshPort: 3080 }), 13080);
  assert.equal(resolvePocketPort({ configPort: 8080.5, dshPort: 3080 }), 13080);
  assert.equal(resolvePocketPort({ settingsPort: 0, dshPort: 3081 }), 13081);
});

// 最小复现（原故障形态）：两个实例（dshPort 3080/3082）并发启动，
// 旧方案默认都抢 13080 → 后者被迫 fallback 到 13081（日志「port busy」）；
// 新方案默认端口天然错开，互不触发 fallback。
test('复现：双实例默认端口错开，不再互相触发 EADDRINUSE fallback', () => {
  const prod = resolvePocketPort({ dshPort: 3080 });
  const test = resolvePocketPort({ dshPort: 3082 });
  assert.notEqual(prod, test);
});
