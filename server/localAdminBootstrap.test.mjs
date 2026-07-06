import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureLocalAdminUser } from './localAdminBootstrap.mjs';

const ENV_KEYS = ['MEIAO_ADMIN_USERNAME', 'MEIAO_ADMIN_PASSWORD'];

const withEnv = (overrides, fn) => {
  const saved = {};
  ENV_KEYS.forEach((key) => {
    saved[key] = process.env[key];
    delete process.env[key];
  });
  Object.entries(overrides).forEach(([key, value]) => {
    process.env[key] = value;
  });
  try {
    return fn();
  } finally {
    ENV_KEYS.forEach((key) => {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    });
  }
};

const createFakeDeps = () => {
  const createUserCalls = [];
  const persistCalls = [];
  return {
    createUserCalls,
    persistCalls,
    createUser: (params) => {
      createUserCalls.push(params);
      return {
        id: `fake-${createUserCalls.length}`,
        username: params.username,
        displayName: params.displayName || params.username,
        role: params.role,
        status: 'active',
        passwordHash: `hash(${params.password})`,
        salt: 'fake-salt',
      };
    },
    persistStore: (store) => {
      persistCalls.push(store);
    },
  };
};

test('store 无 env admin 时补建 admin 用户并持久化', () => {
  withEnv({}, () => {
    const deps = createFakeDeps();
    const store = { users: [] };

    const result = ensureLocalAdminUser(store, deps);

    assert.equal(result.created, true);
    assert.equal(store.users.length, 1);
    const admin = store.users[0];
    assert.equal(admin.username, 'admin');
    assert.equal(admin.role, 'admin');
    assert.equal(admin.status, 'active');
    assert.equal(admin.displayName, '管理员');
    assert.equal(result.user, admin);

    assert.equal(deps.createUserCalls.length, 1);
    assert.deepEqual(deps.createUserCalls[0], {
      username: 'admin',
      password: 'Meiao123456',
      role: 'admin',
      displayName: '管理员',
    });
    assert.equal(deps.persistCalls.length, 1);
    assert.equal(deps.persistCalls[0], store);
  });
});

test('读取 MEIAO_ADMIN_USERNAME / MEIAO_ADMIN_PASSWORD 环境变量', () => {
  withEnv({ MEIAO_ADMIN_USERNAME: 'boss', MEIAO_ADMIN_PASSWORD: 'Secret999' }, () => {
    const deps = createFakeDeps();
    const store = { users: [] };

    const result = ensureLocalAdminUser(store, deps);

    assert.equal(result.created, true);
    assert.deepEqual(deps.createUserCalls[0], {
      username: 'boss',
      password: 'Secret999',
      role: 'admin',
      displayName: '管理员',
    });
  });
});

test('已存在同名用户(不论角色/状态)时零改动:不建、不改、不持久化', () => {
  withEnv({}, () => {
    const deps = createFakeDeps();
    const existing = {
      id: 'user-1',
      username: 'admin',
      role: 'staff',
      status: 'disabled',
      passwordHash: 'old-hash',
      salt: 'old-salt',
      displayName: '老管理员',
    };
    const snapshot = structuredClone(existing);
    const store = { users: [existing] };

    const result = ensureLocalAdminUser(store, deps);

    assert.equal(result.created, false);
    assert.equal(result.user, existing);
    assert.equal(store.users.length, 1);
    assert.equal(store.users[0], existing);
    assert.deepEqual(store.users[0], snapshot);
    assert.equal(deps.createUserCalls.length, 0);
    assert.equal(deps.persistCalls.length, 0);
  });
});

test('幂等:连续调用两次只补建一次', () => {
  withEnv({}, () => {
    const deps = createFakeDeps();
    const store = { users: [] };

    const first = ensureLocalAdminUser(store, deps);
    const second = ensureLocalAdminUser(store, deps);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.user, first.user);
    assert.equal(store.users.length, 1);
    assert.equal(deps.createUserCalls.length, 1);
    assert.equal(deps.persistCalls.length, 1);
  });
});
