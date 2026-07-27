export interface AccountUser {
  id: number;
  passwordHash: string;
}

export interface ApiTokenRecord {
  userId: number;
  name: string;
  tokenHash: string;
  tokenCiphertext: string;
  tokenPrefix: string;
}

export interface AccountTransaction {
  createUser(username: string, passwordHash: string): Promise<number>;
  createApiToken(record: ApiTokenRecord): Promise<void>;
  createLoginToken(userId: number, tokenHash: string): Promise<void>;
  updatePassword?(userId: number, passwordHash: string): Promise<void>;
  deleteLoginTokens?(userId: number): Promise<void>;
}

export interface AccountRepository {
  findUserByUsername(username: string): Promise<AccountUser | null>;
  findUserById?(userId: number): Promise<AccountUser | null>;
  deleteLoginToken?(userId: number, tokenHash: string): Promise<void>;
  transaction<T>(work: (transaction: AccountTransaction) => Promise<T>): Promise<T>;
}

export class UsernameConflictError extends Error {
  constructor() {
    super('username conflict');
    this.name = 'UsernameConflictError';
  }
}

export interface AccountDependencies {
  repository: AccountRepository;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  hashPassword(password: string): Promise<string>;
  hashToken(token: string): string;
  encryptSecret(token: string): string;
  randomHex(bytes: number): string;
}

export interface AccountContext {
  isLoggedIn: boolean;
}

export interface LoginInput {
  username?: string;
  password?: string;
}

export interface RegisterInput extends LoginInput {
  confirmPassword?: string;
}

export interface ChangePasswordInput {
  oldPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

interface LegacyBody {
  code: 0 | 1;
  message: string;
  data?: { logged_out: true };
}

export interface AccountResult {
  status: number;
  body: LegacyBody;
  loginToken?: string;
}

const success = (message: string, loginToken?: string): AccountResult => ({
  status: 200,
  body: { code: 0, message },
  ...(loginToken === undefined ? {} : { loginToken }),
});

const failure = (status: number, message: string): AccountResult => ({
  status,
  body: { code: 1, message },
});

function trim(value: string | undefined): string {
  return (value ?? '').trim();
}

function validUsername(username: string): boolean {
  const length = Array.from(username).length;
  return length >= 3 && length <= 30 && /^[\p{L}\p{N}_-]+$/u.test(username);
}

function validPassword(password: string): boolean {
  const bytes = Buffer.byteLength(password, 'utf8');
  return bytes >= 8 && bytes <= 72;
}

export class AccountService {
  constructor(private readonly dependencies: AccountDependencies) {}

  async login(input: LoginInput, context: AccountContext): Promise<AccountResult> {
    if (context.isLoggedIn) return success('已经登录');

    const username = trim(input.username);
    const password = input.password ?? '';
    if (username === '' || password === '') return failure(422, '请填写用户名和密码');

    const user = await this.dependencies.repository.findUserByUsername(username);
    if (user === null || !(await this.dependencies.verifyPassword(password, user.passwordHash))) {
      return failure(401, '用户名或密码错误');
    }

    const loginToken = this.dependencies.randomHex(32);
    await this.dependencies.repository.transaction(async (transaction) => {
      await transaction.createLoginToken(user.id, this.dependencies.hashToken(loginToken));
    });
    return success('登录成功', loginToken);
  }

  async changePassword(input: ChangePasswordInput, context: { userId: number }): Promise<AccountResult> {
    const oldPassword = input.oldPassword ?? '';
    const newPassword = input.newPassword ?? '';
    const confirmPassword = input.confirmPassword ?? '';
    if (oldPassword === '' || newPassword === '' || confirmPassword === '') return failure(422, '请填写所有密码字段');
    if (Buffer.byteLength(newPassword, 'utf8') < 8) return failure(422, '新密码至少8位');
    if (Buffer.byteLength(newPassword, 'utf8') > 72) return failure(422, '密码长度需为8至72位');
    if (newPassword !== confirmPassword) return failure(422, '两次新密码不一致');
    if (!this.dependencies.repository.findUserById) throw new Error('account repository does not support password changes');
    const user = await this.dependencies.repository.findUserById(context.userId);
    if (user === null || !(await this.dependencies.verifyPassword(oldPassword, user.passwordHash))) return failure(422, '当前密码错误');
    const passwordHash = await this.dependencies.hashPassword(newPassword);
    await this.dependencies.repository.transaction(async (transaction) => {
      if (!transaction.updatePassword || !transaction.deleteLoginTokens) throw new Error('account transaction does not support password changes');
      await transaction.updatePassword(context.userId, passwordHash);
      await transaction.deleteLoginTokens(context.userId);
    });
    return { status: 200, body: { code: 0, message: '密码修改成功，所有设备已退出登录', data: { logged_out: true } } };
  }

  async logout(userId: number, token: string): Promise<AccountResult & { clearLogin: true }> {
    if (!this.dependencies.repository.deleteLoginToken) throw new Error('account repository does not support logout');
    await this.dependencies.repository.deleteLoginToken(userId, this.dependencies.hashToken(token));
    return { status: 200, body: { code: 0, message: '已退出登录' }, clearLogin: true };
  }

  async register(input: RegisterInput, context: AccountContext): Promise<AccountResult> {
    if (context.isLoggedIn) return failure(409, '请先退出当前账号再注册');

    const username = trim(input.username);
    const password = input.password ?? '';
    const confirmPassword = input.confirmPassword ?? '';
    if (username === '' || password === '' || confirmPassword === '') {
      return failure(422, '请填写用户名和两次密码');
    }
    if (!validUsername(username)) {
      return failure(422, '用户名需为3至30位，只能使用中文、字母、数字、下划线或短横线');
    }
    if (!validPassword(password)) return failure(422, '密码长度需为8至72位');
    if (password !== confirmPassword) return failure(422, '两次输入的密码不一致');

    try {
      const passwordHash = await this.dependencies.hashPassword(password);
      const apiToken = this.dependencies.randomHex(24);
      const loginToken = this.dependencies.randomHex(32);
      await this.dependencies.repository.transaction(async (transaction) => {
        const userId = await transaction.createUser(username, passwordHash);
        await transaction.createApiToken({
          userId,
          name: '我的 iPhone',
          tokenHash: this.dependencies.hashToken(apiToken),
          tokenCiphertext: this.dependencies.encryptSecret(apiToken),
          tokenPrefix: apiToken.slice(0, 8),
        });
        await transaction.createLoginToken(userId, this.dependencies.hashToken(loginToken));
      });
      return success('注册成功', loginToken);
    } catch (error) {
      if (error instanceof UsernameConflictError) return failure(409, '该用户名已被注册');
      return failure(500, '注册失败，请稍后重试');
    }
  }
}
