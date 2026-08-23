// 回归：同机双实例（13080/13081）会话 cookie 按端口隔离——
// RFC 6265 cookie 域匹配不含端口，固定 cookie 名会让 13081 登录顶掉 13080（用户实测）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenCookieName } from '../lib/proxy.mjs';

test('tokenCookieName: 每个代理端口一个独立 cookie 名', () => {
  assert.equal(tokenCookieName(13080), 'dsh_pocket_token_13080');
  assert.equal(tokenCookieName(13081), 'dsh_pocket_token_13081');
  assert.notEqual(tokenCookieName(13080), tokenCookieName(13081));
});