import { describe, expect, it, vi } from 'vitest';
import {
  AccountService,
  UsernameConflictError,
  type AccountRepository,
  type AccountTransaction,
  type ApiTokenRecord,
} from '../../../src/modules/account/service.js';
import { createAccountCrypto } from '../../../src/modules/account/crypto.js';
import { decryptLegacySecret } from '../../../src/platform/legacy-crypto.js';

const phpHash = '$2y$10$N9u1Bni/xliYySmRs0U2duD79WS34lsqNn670iwYXopepVpjwQhlS';

class MemoryRepository implements AccountRepository {
  readonly users = new Map<string, { id: number; passwordHash: string }>();
  readonly apiTokens: ApiTokenRecord[] = [];
  readonly loginTokens: Array<{ userId: number; tokenHash: string }> = [];
  failTransaction = false;
  conflict = false;

  findUserByUsername(username: string) {
    return Promise.resolve(this.users.get(username) ?? null);
  }

  async transaction<T>(work: (transaction: AccountTransaction) => Promise<T>): Promise<T> {
    const users = new Map(this.users);
    const apiTokens = [...this.apiTokens];
    const loginTokens = [...this.loginTokens];
    const transaction: AccountTransaction = {
      createUser: (username, passwordHash) => {
        if (this.conflict || users.has(username)) return Promise.reject(new UsernameConflictError());
        const id = users.size + 1;
        users.set(username, { id, passwordHash });
        return Promise.resolve(id);
      },
      createApiToken: (record) => { apiTokens.push(record); return Promise.resolve(); },
      createLoginToken: (userId, tokenHash) => { loginTokens.push({ userId, tokenHash }); return Promise.resolve(); },
    };
    const result = await work(transaction);
    if (this.failTransaction) throw new Error('commit failed');
    this.users.clear();
    for (const [name, user] of users) this.users.set(name, user);
    this.apiTokens.splice(0, this.apiTokens.length, ...apiTokens);
    this.loginTokens.splice(0, this.loginTokens.length, ...loginTokens);
    return result;
  }
}

function setup(repository = new MemoryRepository()) {
  let randomCall = 0;
  const dependencies = {
    repository,
    verifyPassword: vi.fn((password: string, hash: string) => Promise.resolve(password === 'correct-password' && hash === phpHash)),
    hashPassword: vi.fn(() => Promise.resolve(phpHash)),
    hashToken: vi.fn((token: string) => `hash:${token}`),
    encryptSecret: vi.fn((token: string) => `encrypted:${token}`),
    randomHex: vi.fn((bytes: number) => {
      randomCall += 1;
      return (randomCall % 2 === 1 ? 'a' : 'b').repeat(bytes * 2);
    }),
  };
  return { repository, dependencies, service: new AccountService(dependencies) };
}

const failure = (status: number, message: string) => ({ status, body: { code: 1, message } });

describe('AccountService login', () => {
  it('preserves the already-logged-in response without repository access', async () => {
    const { service, dependencies } = setup();
    await expect(service.login({ username: '', password: '' }, { isLoggedIn: true })).resolves.toEqual({
      status: 200, body: { code: 0, message: '已经登录' },
    });
    expect(dependencies.verifyPassword).not.toHaveBeenCalled();
  });

  it('validates required trimmed username and password', async () => {
    const { service } = setup();
    await expect(service.login({ username: '  ', password: '' }, { isLoggedIn: false })).resolves.toEqual(
      failure(422, '请填写用户名和密码'),
    );
  });

  it('verifies a legacy bcrypt hash and creates a 64-hex login token transactionally', async () => {
    const { service, repository, dependencies } = setup();
    repository.users.set('alice', { id: 7, passwordHash: phpHash });
    const result = await service.login({ username: ' alice ', password: 'correct-password' }, { isLoggedIn: false });
    expect(dependencies.verifyPassword).toHaveBeenCalledWith('correct-password', phpHash);
    expect(result).toEqual({ status: 200, body: { code: 0, message: '登录成功' }, loginToken: 'a'.repeat(64) });
    expect(repository.loginTokens).toEqual([{ userId: 7, tokenHash: `hash:${'a'.repeat(64)}` }]);
  });

  it('uses the same unauthorized response for unknown users and bad passwords', async () => {
    const { service, repository } = setup();
    await expect(service.login({ username: 'nobody', password: 'correct-password' }, { isLoggedIn: false })).resolves.toEqual(
      failure(401, '用户名或密码错误'),
    );
    repository.users.set('alice', { id: 1, passwordHash: phpHash });
    await expect(service.login({ username: 'alice', password: 'wrong-password' }, { isLoggedIn: false })).resolves.toEqual(
      failure(401, '用户名或密码错误'),
    );
  });

  it('does not return success when login-token persistence fails', async () => {
    const { service, repository } = setup();
    repository.users.set('alice', { id: 1, passwordHash: phpHash });
    repository.failTransaction = true;
    await expect(service.login({ username: 'alice', password: 'correct-password' }, { isLoggedIn: false })).rejects.toThrow('commit failed');
    expect(repository.loginTokens).toHaveLength(0);
  });
});

describe('AccountService register', () => {
  it('rejects registration while logged in with legacy semantics', async () => {
    const { service } = setup();
    await expect(service.register({}, { isLoggedIn: true })).resolves.toEqual(failure(409, '请先退出当前账号再注册'));
  });

  it('requires username, password, and confirmation', async () => {
    const { service } = setup();
    await expect(service.register({ username: 'alice', password: 'password' }, { isLoggedIn: false })).resolves.toEqual(
      failure(422, '请填写用户名和两次密码'),
    );
  });

  it.each(['ab', 'a'.repeat(31), 'alice!', 'a b', '👩‍💻user'])('rejects invalid Unicode username %s', async (username) => {
    const { service } = setup();
    await expect(service.register({ username, password: 'password', confirmPassword: 'password' }, { isLoggedIn: false })).resolves.toEqual(
      failure(422, '用户名需为3至30位，只能使用中文、字母、数字、下划线或短横线'),
    );
  });

  it.each(['张三丰', 'éclair', '用户_１２３-test'])('accepts Unicode letters and numbers in username %s', async (username) => {
    const { service } = setup();
    const result = await service.register({ username, password: 'password', confirmPassword: 'password' }, { isLoggedIn: false });
    expect(result.body).toEqual({ code: 0, message: '注册成功' });
  });

  it.each(['1234567', '密'.repeat(2), `${'a'.repeat(71)}é`])('rejects passwords outside 8-72 UTF-8 bytes', async (password) => {
    const { service } = setup();
    await expect(service.register({ username: 'alice', password, confirmPassword: password }, { isLoggedIn: false })).resolves.toEqual(
      failure(422, '密码长度需为8至72位'),
    );
  });

  it('checks confirmation after password length', async () => {
    const { service } = setup();
    await expect(service.register({ username: 'alice', password: 'password', confirmPassword: 'different' }, { isLoggedIn: false })).resolves.toEqual(
      failure(422, '两次输入的密码不一致'),
    );
  });

  it('atomically creates user, encrypted 48-hex API token, and 64-hex login token', async () => {
    const { service, repository, dependencies } = setup();
    const result = await service.register({ username: ' alice ', password: 'password', confirmPassword: 'password' }, { isLoggedIn: false });
    const apiToken = 'a'.repeat(48);
    const loginToken = 'b'.repeat(64);
    expect(result).toEqual({ status: 200, body: { code: 0, message: '注册成功' }, loginToken });
    expect(repository.apiTokens).toEqual([{
      userId: 1, name: '我的 iPhone', tokenHash: `hash:${apiToken}`,
      tokenCiphertext: `encrypted:${apiToken}`, tokenPrefix: 'aaaaaaaa',
    }]);
    expect(repository.loginTokens).toEqual([{ userId: 1, tokenHash: `hash:${loginToken}` }]);
    expect(dependencies.randomHex).toHaveBeenNthCalledWith(1, 24);
    expect(dependencies.randomHex).toHaveBeenNthCalledWith(2, 32);
  });

  it('maps repository username conflicts to HTTP 409', async () => {
    const { service, repository } = setup();
    repository.conflict = true;
    await expect(service.register({ username: 'alice', password: 'password', confirmPassword: 'password' }, { isLoggedIn: false })).resolves.toEqual(
      failure(409, '该用户名已被注册'),
    );
  });

  it('maps other transaction errors to legacy HTTP 500 and commits nothing', async () => {
    const { service, repository } = setup();
    repository.failTransaction = true;
    await expect(service.register({ username: 'alice', password: 'password', confirmPassword: 'password' }, { isLoggedIn: false })).resolves.toEqual(
      failure(500, '注册失败，请稍后重试'),
    );
    expect(repository.users).toHaveLength(0);
    expect(repository.apiTokens).toHaveLength(0);
    expect(repository.loginTokens).toHaveLength(0);
  });
});

describe('account crypto dependencies', () => {
  it('generates lowercase hex at the requested byte length and encrypts API secrets compatibly', () => {
    const key = '00'.repeat(32);
    const crypto = createAccountCrypto(key);
    expect(crypto.randomHex(32)).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.randomHex(24)).toMatch(/^[0-9a-f]{48}$/);
    const encrypted = crypto.encryptSecret('a'.repeat(48));
    expect(decryptLegacySecret(encrypted, key)).toBe('a'.repeat(48));
  });

  it('uses the legacy-compatible password implementation', async () => {
    const crypto = createAccountCrypto('00'.repeat(32));
    await expect(crypto.verifyPassword('Fictional-Pickup-Only-2026!', phpHash)).resolves.toBe(true);
  });
});
