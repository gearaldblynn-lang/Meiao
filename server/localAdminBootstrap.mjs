// 本地 JSON 模式启动时幂等补建 env admin 用户。
// 背景:ensureLocalStore 只在 store 文件不存在时创建 admin;
// 老 store 已存在但没有 env admin 时,按 .env.server 文档登录必 401(S5)。
// 注意:MySQL 模式的引导逻辑(users 表空时建)语义不同,不走这里。

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'Meiao123456';

/**
 * store.users 中不存在 env admin 同名用户时,用注入的 createUser 补建并持久化。
 * 已存在同名用户(不论角色/状态)时零改动(不改密码、不改角色、不持久化)。
 *
 * @param {{ users?: Array<object> }} store 本地 store 对象(会被原地修改)
 * @param {{ createUser: Function, persistStore?: Function }} deps 依赖注入:
 *   createUser 为 index.mjs 既有的用户工厂;persistStore 负责落盘(如 writeLocalStore)。
 * @returns {{ created: boolean, user: object }}
 */
export const ensureLocalAdminUser = (store, { createUser, persistStore } = {}) => {
  const username = process.env.MEIAO_ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME;
  if (!Array.isArray(store.users)) {
    store.users = [];
  }
  const existing = store.users.find((user) => user && user.username === username);
  if (existing) {
    return { created: false, user: existing };
  }
  const admin = createUser({
    username,
    password: process.env.MEIAO_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,
    role: 'admin',
    displayName: '管理员',
  });
  store.users.push(admin);
  if (typeof persistStore === 'function') {
    persistStore(store);
  }
  return { created: true, user: admin };
};
