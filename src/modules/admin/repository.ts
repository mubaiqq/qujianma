export interface AdminSqlExecutor {
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}

export interface AdminOverview {
  totalUsers: number;
  pendingParcels: number;
  activeAiUsers: number;
}

export interface AdminUserSummary {
  id: number;
  username: string;
  createdAt: Date | string;
  parcelCount: number;
  pendingCount: number;
  pickedCount: number;
  stationCount: number;
  messageCount: number;
  aiCount: number;
  activeAiCount: number;
  lastSeenAt: Date | string | null;
}

export interface AdminAiProvider {
  displayName: string;
  modelName: string;
  active: boolean;
  lastTestStatus: string;
  lastTestMessage: string;
  lastTestedAt: Date | string | null;
}

export interface AdminUserDetail {
  id: number;
  username: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  totalParcels: number;
  pendingParcels: number;
  pickedParcels: number;
  totalStations: number;
  totalMessages: number;
  failedMessages: number;
  aiCount: number;
  activeAiCount: number;
  activeApiTokens: number;
  pushDevices: number;
  lastSeenAt: Date | string | null;
  providers: AdminAiProvider[];
}

export interface PublishedArticle { id:number; title:string; summary:string; contentHtml:string; authorName:string; createdAt:Date|string }

export interface AdminRepository {
  overview(): Promise<AdminOverview>;
  listUsers(): Promise<AdminUserSummary[]>;
  getUser(id: number): Promise<AdminUserDetail | null>;
  createArticle(input: { title: string; summary: string; contentHtml: string; authorId: number; authorName: string }): Promise<number>;
  listArticles(): Promise<PublishedArticle[]>;
  getArticle(id: number): Promise<PublishedArticle | null>;
}

type Row = Record<string, unknown>;
const number = (value: unknown): number => Number(value ?? 0);
const value = (row: Row, key: string): Date | string => row[key] as Date | string;
const nullableValue = (row: Row, key: string): Date | string | null => row[key] == null ? null : value(row, key);

export class MysqlAdminRepository implements AdminRepository {
  constructor(private readonly executor: AdminSqlExecutor) {}

  async overview(): Promise<AdminOverview> {
    const [rows] = await this.executor.execute(
      "SELECT (SELECT COUNT(*) FROM users) total_users,(SELECT COUNT(*) FROM parcels WHERE status='pending') pending_parcels,(SELECT COUNT(DISTINCT user_id) FROM ai_providers WHERE is_active=1) active_ai_users",
    );
    const row = (rows as Row[])[0] ?? {};
    return { totalUsers: number(row.total_users), pendingParcels: number(row.pending_parcels), activeAiUsers: number(row.active_ai_users) };
  }

  async listUsers(): Promise<AdminUserSummary[]> {
    const [rows] = await this.executor.execute(
      "SELECT u.id,u.username,u.created_at,(SELECT COUNT(*) FROM parcels WHERE user_id=u.id) parcel_count,(SELECT COUNT(*) FROM parcels WHERE user_id=u.id AND status='pending') pending_count,(SELECT COUNT(*) FROM parcels WHERE user_id=u.id AND status='picked_up') picked_count,(SELECT COUNT(*) FROM stations WHERE user_id=u.id) station_count,(SELECT COUNT(*) FROM incoming_messages WHERE user_id=u.id) message_count,(SELECT COUNT(*) FROM ai_providers WHERE user_id=u.id) ai_count,(SELECT COUNT(*) FROM ai_providers WHERE user_id=u.id AND is_active=1) active_ai_count,(SELECT MAX(last_used_at) FROM login_tokens WHERE user_id=u.id) last_seen_at FROM users u ORDER BY u.id=1 DESC,u.created_at DESC,u.id DESC",
    );
    return (rows as Row[]).map((row) => ({
      id: number(row.id), username: String(row.username), createdAt: value(row, 'created_at'),
      parcelCount: number(row.parcel_count), pendingCount: number(row.pending_count), pickedCount: number(row.picked_count),
      stationCount: number(row.station_count), messageCount: number(row.message_count), aiCount: number(row.ai_count),
      activeAiCount: number(row.active_ai_count), lastSeenAt: nullableValue(row, 'last_seen_at'),
    }));
  }

  async getUser(id: number): Promise<AdminUserDetail | null> {
    const [rows] = await this.executor.execute(
      "SELECT u.id,u.username,u.created_at,u.updated_at,(SELECT COUNT(*) FROM parcels WHERE user_id=u.id) total_parcels,(SELECT COUNT(*) FROM parcels WHERE user_id=u.id AND status='pending') pending_parcels,(SELECT COUNT(*) FROM parcels WHERE user_id=u.id AND status='picked_up') picked_parcels,(SELECT COUNT(*) FROM stations WHERE user_id=u.id) total_stations,(SELECT COUNT(*) FROM incoming_messages WHERE user_id=u.id) total_messages,(SELECT COUNT(*) FROM incoming_messages WHERE user_id=u.id AND ai_status='failed') failed_messages,(SELECT COUNT(*) FROM ai_providers WHERE user_id=u.id) ai_count,(SELECT COUNT(*) FROM ai_providers WHERE user_id=u.id AND is_active=1) active_ai_count,(SELECT COUNT(*) FROM api_tokens WHERE user_id=u.id AND revoked_at IS NULL) active_api_tokens,(SELECT COUNT(*) FROM push_subscriptions WHERE user_id=u.id) push_devices,(SELECT MAX(last_used_at) FROM login_tokens WHERE user_id=u.id) last_seen_at FROM users u WHERE u.id=?",
      [id],
    );
    const row = (rows as Row[])[0];
    if (!row) return null;
    const [providerRows] = await this.executor.execute(
      'SELECT display_name,model_name,is_active,last_test_status,last_test_message,last_tested_at FROM ai_providers WHERE user_id=? ORDER BY is_active DESC,id DESC',
      [id],
    );
    return {
      id: number(row.id), username: String(row.username), createdAt: value(row, 'created_at'), updatedAt: value(row, 'updated_at'),
      totalParcels: number(row.total_parcels), pendingParcels: number(row.pending_parcels), pickedParcels: number(row.picked_parcels),
      totalStations: number(row.total_stations), totalMessages: number(row.total_messages), failedMessages: number(row.failed_messages),
      aiCount: number(row.ai_count), activeAiCount: number(row.active_ai_count), activeApiTokens: number(row.active_api_tokens),
      pushDevices: number(row.push_devices), lastSeenAt: nullableValue(row, 'last_seen_at'),
      providers: (providerRows as Row[]).map((provider) => ({
        displayName: String(provider.display_name), modelName: String(provider.model_name), active: number(provider.is_active) === 1,
        lastTestStatus: String(provider.last_test_status), lastTestMessage: String(provider.last_test_message),
        lastTestedAt: nullableValue(provider, 'last_tested_at'),
      })),
    };
  }

  async createArticle(input: { title:string; summary:string; contentHtml:string; authorId:number; authorName:string }): Promise<number> {
    const [result]=await this.executor.execute('INSERT INTO published_articles(title,summary,content_html,author_id,author_name) VALUES(?,?,?,?,?)',[input.title,input.summary,input.contentHtml,input.authorId,input.authorName]);
    return Number((result as {insertId?:unknown}).insertId??0);
  }
  async listArticles(): Promise<PublishedArticle[]> {
    const [rows]=await this.executor.execute('SELECT id,title,summary,content_html,author_name,created_at FROM published_articles ORDER BY created_at DESC,id DESC LIMIT 100');
    return (rows as Row[]).map(row=>({id:number(row.id),title:String(row.title),summary:String(row.summary),contentHtml:String(row.content_html),authorName:String(row.author_name),createdAt:value(row,'created_at')}));
  }
  async getArticle(id:number): Promise<PublishedArticle|null> {
    const [rows]=await this.executor.execute('SELECT id,title,summary,content_html,author_name,created_at FROM published_articles WHERE id=?',[id]);const row=(rows as Row[])[0];
    return row?{id:number(row.id),title:String(row.title),summary:String(row.summary),contentHtml:String(row.content_html),authorName:String(row.author_name),createdAt:value(row,'created_at')}:null;
  }
}
