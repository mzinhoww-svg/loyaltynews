import type { McpTransport } from '../mlabs/live';

// Transporte de LEITURA simulado do mLabs, para testes. As formas de `list_profiles`, `list_channels`, `list_published_posts` (vazio) e
// `get_follower_growth` são as OBSERVADAS em 23/11/2026 (leitura real, conta com 0 posts); a forma de cada post publicado NÃO foi
// observada (nenhum post existe) e aqui é só uma suposição de teste. Nunca chama rede.

export const SIM_PROFILE_ID = 'ext_perfil-simulado';
export const SIM_CHANNEL_ID = 'ext_canal-simulado';

export interface SimReadOptions {
  posts?: Record<string, unknown>[];
  pageSize?: number;
  followers?: { date: string; followerCount: number }[];
  /** Ferramenta que falha (lança). */
  failTool?: string;
  /** Respostas fixas por ferramenta (sobrepõem o padrão). */
  override?: Record<string, unknown>;
  channels?: { id: string; name: string; channel: string; active?: boolean }[];
  profiles?: { id: string; name: string; active: boolean; connectedChannels: string[] }[];
}

export class SimulatedMlabsReadTransport implements McpTransport {
  readonly calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private readonly o: SimReadOptions = {}) {}

  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ tool, args });
    if (this.o.failTool === tool) throw new Error('falha simulada: token=segredo-que-nao-deve-vazar');
    if (this.o.override && tool in this.o.override) return this.o.override[tool];
    switch (tool) {
      case 'list_profiles':
        return { items: this.o.profiles ?? [{ id: SIM_PROFILE_ID, name: 'Perfil simulado', segment: '', active: true, connectedChannels: ['LINKEDIN'], createdAt: '' }], totalCount: 1 };
      case 'list_channels':
        return this.o.channels ?? [{ id: SIM_CHANNEL_ID, name: 'Loyalty News', channel: 'linkedin', active: true }];
      case 'list_published_posts': {
        const all = this.o.posts ?? [];
        if (all.length === 0) return { posts: [], totalCount: 0, hasMore: false, message: 'Nenhum conteúdo encontrado no período informado.' };
        const size = this.o.pageSize ?? 100;
        const from = args.cursor ? Number(args.cursor) : 0;
        const page = all.slice(from, from + size);
        const next = from + size;
        return { posts: page, totalCount: all.length, hasMore: next < all.length, ...(next < all.length ? { nextCursor: String(next) } : {}) };
      }
      case 'get_follower_growth': {
        const tl = this.o.followers ?? [{ date: '2026-11-22T00:00:00.000Z', followerCount: 0 }];
        if (tl.length === 0) return { profileId: args.profileId, period: { startDate: args.startDate, endDate: args.endDate }, timeline: [], summary: null, status: 'no_data' };
        const first = tl[0]!;
        const last = tl[tl.length - 1]!;
        return {
          profileId: args.profileId, period: { startDate: args.startDate, endDate: args.endDate },
          timeline: tl.map((t, i) => ({ ...t, dailyChange: i === 0 ? 0 : t.followerCount - tl[i - 1]!.followerCount, dailyChangePercent: null, observedIntervalDays: i === 0 ? 0 : 1 })),
          summary: { startFollowers: first.followerCount, endFollowers: last.followerCount, totalGrowth: last.followerCount - first.followerCount },
          status: 'ok',
        };
      }
      default:
        throw new Error(`ferramenta não simulada: ${tool}`);
    }
  }
}
