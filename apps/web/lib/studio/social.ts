// Social Dashboard do Studio: liga os handlers de @ln/growth/dashboard a um armazenamento em memória e a um adaptador
// SOMENTE LEITURA. O Studio não publica nada no mLabs: a escrita é recusada (identidade de publicação é outra, ADR-008).
// Geração de pacotes depende de matérias com fatos aprovados e gates automáticos (WF02/WF03) da Fábrica editorial.
import type { Role, Session } from '@ln/auth';
import { WriteGate, growthFlagsFrom, SocialPublisher, type MlabsAdapter, type PostPayload, type PublishReceipt } from '@ln/growth';
import { InMemoryPackageStore, PERMISSIONS, type ArticleSource, type Caller, type DashboardDeps } from '@ln/growth/dashboard';
import { singleton } from './registros';

/** Adaptador sem rede: leituras vazias, escritas sempre recusadas. */
class AdaptadorSomenteLeitura implements MlabsAdapter {
  readonly mode = 'simulated' as const;
  private readonly gate = new WriteGate();
  bindWriteAuthority(cap: Parameters<WriteGate['bind']>[0]): void {
    this.gate.bind(cap);
  }
  async listChannels() {
    return [];
  }
  async getPostLimits() {
    return { raw: null };
  }
  async listTemplates() {
    return [];
  }
  private async recusar(cap: Parameters<WriteGate['assert']>[0]): Promise<never> {
    this.gate.assert(cap);
    throw new Error('Escrita indisponível no LN Studio: sem integração com o mLabs.');
  }
  createPost(cap: Parameters<WriteGate['assert']>[0], _p: PostPayload, _k: string): Promise<PublishReceipt> {
    return this.recusar(cap);
  }
  updatePost(cap: Parameters<WriteGate['assert']>[0]): Promise<PublishReceipt> {
    return this.recusar(cap);
  }
  deletePost(cap: Parameters<WriteGate['assert']>[0]): Promise<PublishReceipt> {
    return this.recusar(cap);
  }
}

/** Sem fonte de matérias com fatos aprovados, nenhuma matéria é elegível. */
const semMaterias: ArticleSource = { get: async () => null };

export function socialDeps(): DashboardDeps {
  return singleton('social', () => {
    const adapter = new AdaptadorSomenteLeitura();
    const flags = growthFlagsFrom();
    return { store: new InMemoryPackageStore(), articles: semMaterias, publisher: new SocialPublisher({ adapter, flags }), adapter, flags, now: () => new Date().toISOString() };
  });
}

const LEITURA: readonly Role[] = ['admin', 'editor_chefe', 'editor', 'revisor'];

/** Tradução de papel do Studio em permissões do dashboard (a autorização real fica em @ln/auth). */
export function socialCaller(session: Session): Caller {
  const permissions: string[] = session.roles.some((r) => LEITURA.includes(r)) ? [PERMISSIONS.read] : [];
  return { id: session.userId, permissions };
}
