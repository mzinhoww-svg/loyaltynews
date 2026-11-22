// Registro dos módulos do LN Studio (Blueprint v2.0 §5 e §9, rotas /admin/*). Fonte única da navegação, do controle de acesso e dos estados vazios.
import type { FlagName } from '@ln/contracts';
import type { Role, Session } from '@ln/auth';

export type GrupoId = 'editorial' | 'distribuicao' | 'intelligence' | 'comercial' | 'organizacao' | 'tecnologia' | 'administracao';

export const GRUPOS: Record<GrupoId, string> = {
  editorial: 'Editorial',
  distribuicao: 'Distribuição e Growth',
  intelligence: 'Intelligence',
  comercial: 'Comercial',
  organizacao: 'Organização agêntica',
  tecnologia: 'Tecnologia e custos',
  administracao: 'Administração',
};

export interface StudioModule {
  slug: string;
  nome: string;
  grupo: GrupoId;
  descricao: string;
  /** Funções essenciais (Blueprint §5): listadas no estado vazio como escopo previsto. */
  funcoes: readonly string[];
  /** Papéis com acesso. Negar por padrão: papel fora da lista não entra. */
  roles: readonly Role[];
  /** Flag do contrato que libera o backend do módulo, quando existir. Desligada por padrão. */
  flag?: FlagName;
  /** true: tela com funcionamento próprio (hoje só o CMS editorial). false: tela funcional com estado vazio. */
  implementado: boolean;
  /** Rota(s) /admin do Blueprint §9 que este módulo cobre. */
  rotasBlueprint?: readonly string[];
}

const EDITORIAL: readonly Role[] = ['admin', 'editor_chefe', 'editor', 'revisor'];
const EDITORIAL_LEITURA: readonly Role[] = [...EDITORIAL, 'leitor'];
const COMERCIAL: readonly Role[] = ['admin', 'comercial'];
const CHEFIA: readonly Role[] = ['admin', 'editor_chefe'];
const ADMIN: readonly Role[] = ['admin'];
const TODOS: readonly Role[] = ['admin', 'editor_chefe', 'editor', 'revisor', 'comercial', 'leitor'];

export const MODULES: readonly StudioModule[] = [
  { slug: 'cms', nome: 'CMS editorial', grupo: 'editorial', descricao: 'Fila editorial, editor com fontes, imagem e base de direito, versões, revisão e fila de checagem.', funcoes: ['Fila por estado, editoria e busca', 'Editor com fontes e claims', 'Imagem e base de direito', 'Versões (edição gera nova versão)', 'Fila de checagem e aprovação ligada à versão'], roles: EDITORIAL_LEITURA, implementado: true },
  { slug: 'fontes', nome: 'Banco de fontes', grupo: 'editorial', descricao: 'Cadastro de fontes públicas, conectores, permissão e cooldown.', funcoes: ['CRUD de fontes', 'Conectores e teste de fetch permitido', 'Status, permissão e licença', 'Cooldown e logs'], roles: EDITORIAL, implementado: true },
  { slug: 'publicacoes', nome: 'Publicações', grupo: 'editorial', descricao: 'Estados de publicação, despublicação e correções.', funcoes: ['Publicações por estado', 'Correções e despublicação', 'Histórico de versões publicadas'], roles: EDITORIAL, flag: 'publicacaoAutonoma', implementado: false },
  { slug: 'agenda', nome: 'Agenda e eventos', grupo: 'editorial', descricao: 'Calendário editorial e eventos moderados com fonte oficial.', funcoes: ['CRUD de eventos e moderação', 'Datas, links e cobertura', 'Calendário editorial multicanal'], roles: EDITORIAL, implementado: true },
  { slug: 'editorias', nome: 'Editorias', grupo: 'editorial', descricao: 'As dez editorias, tags e redações especializadas.', funcoes: ['Dez editorias', 'Tags', 'Redações (desks): editor, redator, cobertura'], roles: EDITORIAL, implementado: false, rotasBlueprint: ['/admin/editorial/desks'] },
  { slug: 'home-menus', nome: 'Home e menus', grupo: 'editorial', descricao: 'Ordem dos blocos da home, menus, rodapé e espaços publicitários.', funcoes: ['Ordenação e pin', 'Agendamento', 'Preview e rollback', 'Posições com dimensão reservada'], roles: CHEFIA, implementado: true },
  { slug: 'seo', nome: 'SEO', grupo: 'editorial', descricao: 'Canônica, redirecionamentos, indexação, sitemap e RSS.', funcoes: ['Redirects', 'Indexação e sitemap', 'Dados estruturados', 'Links internos'], roles: EDITORIAL, implementado: true },
  { slug: 'midia', nome: 'Biblioteca de mídia', grupo: 'editorial', descricao: 'Upload com metadados, evidência de licença, expiração e texto alternativo.', funcoes: ['Upload e metadados', 'Evidência de licença e expiração', 'Texto alternativo', 'Deduplicação'], roles: EDITORIAL, implementado: true },
  { slug: 'social', nome: 'Social dashboard', grupo: 'distribuicao', descricao: 'Cópias por canal, aprovação e status. Instagram e The Loyal construídos e desligados.', funcoes: ['Cópias por canal e preview', 'Aprovação', 'Fallback export/manual', 'Status e deduplicação'], roles: EDITORIAL, flag: 'linkedinPublicacao', implementado: true },
  { slug: 'creative', nome: 'Creative studio', grupo: 'distribuicao', descricao: 'Templates e peças sociais determinísticas.', funcoes: ['Templates de peça', 'Composição determinística', 'Aprovação de criativo'], roles: EDITORIAL, flag: 'instagram', implementado: false },
  { slug: 'entidades', nome: 'Entity intelligence', grupo: 'intelligence', descricao: 'Cadastro de entidades com evidência por campo.', funcoes: ['Identidade e aliases', 'Evidências e conflitos', 'Revisão e histórico'], roles: EDITORIAL, flag: 'intelligencePessoas', implementado: true, rotasBlueprint: ['/admin/intelligence', '/admin/intelligence/entities/{id}', '/admin/intelligence/moves', '/admin/intelligence/graph'] },
  { slug: 'organogramas', nome: 'Organogramas', grupo: 'intelligence', descricao: 'Organograma temporal com evidência por vínculo.', funcoes: ['Árvore expansível', 'Timeline e versões', 'Evidência por vínculo', 'Snapshot'], roles: EDITORIAL, flag: 'intelligencePessoas', implementado: true, rotasBlueprint: ['/admin/intelligence/orgchart/{id}'] },
  { slug: 'watchlists', nome: 'Watchlists', grupo: 'intelligence', descricao: 'Acompanhamento de entidades e movimentações.', funcoes: ['Entidades acompanhadas', 'Alertas de movimentação'], roles: TODOS, flag: 'intelligencePessoas', implementado: true },
  { slug: 'crm', nome: 'CRM', grupo: 'comercial', descricao: 'Leads, pipeline, propostas e histórico.', funcoes: ['Leads e pipeline', 'Proposta versionada', 'Tarefas e histórico'], roles: COMERCIAL, implementado: true },
  { slug: 'inventario', nome: 'Inventário', grupo: 'comercial', descricao: 'Slots, capacidade e reserva. Nenhum formato sem capacidade fica à venda.', funcoes: ['Calendário por slot', 'Capacidade e reserva', 'Exclusividade e preview'], roles: COMERCIAL, flag: 'adServerVendas', implementado: true },
  { slug: 'campanhas', nome: 'Campanhas', grupo: 'comercial', descricao: 'Flights, criativos, UTM, entrega e relatório.', funcoes: ['Flight e anunciante', 'Criativos e pesos', 'UTM e relatório'], roles: COMERCIAL, flag: 'adServerVendas', implementado: true },
  { slug: 'analytics', nome: 'Analytics', grupo: 'comercial', descricao: 'GA4, CMS, ESP e social. Sem dado real, estado vazio.', funcoes: ['Snapshots por fonte', 'Saúde dos conectores', 'Relatórios'], roles: [...COMERCIAL, 'editor_chefe'], flag: 'analytics', implementado: false },
  { slug: 'organizacao', nome: 'Organização agêntica', grupo: 'organizacao', descricao: 'Command center, organograma de agentes, diretorias e redações.', funcoes: ['Command center', 'Organograma de agentes', 'Agentes e diretorias'], roles: CHEFIA, flag: 'rituais', implementado: true, rotasBlueprint: ['/admin/command', '/admin/organization', '/admin/agents/{id}', '/admin/departments/{id}'] },
  { slug: 'reunioes', nome: 'Calendário de reuniões', grupo: 'organizacao', descricao: 'Reuniões e rituais por dia, semana e mês.', funcoes: ['Calendário dia/semana/mês', 'Convocação', 'Sala e ata'], roles: CHEFIA, flag: 'rituais', implementado: true, rotasBlueprint: ['/admin/meetings', '/admin/meetings/{id}'] },
  { slug: 'decisoes', nome: 'Decisões e atas', grupo: 'organizacao', descricao: 'Action tracker auditável.', funcoes: ['Decisões e ações', 'Prazo, SLA e evidência', 'Reabrir e escalar'], roles: CHEFIA, flag: 'rituais', implementado: true, rotasBlueprint: ['/admin/actions'] },
  { slug: 'modelops', nome: 'ModelOps', grupo: 'tecnologia', descricao: 'Catálogo de modelos, roteamento e evals.', funcoes: ['Catálogo e health', 'Regras de roteamento (dry run)', 'Evals e promoção humana'], roles: ADMIN, flag: 'modelosHabilitados', implementado: false, rotasBlueprint: ['/admin/modelops', '/admin/modelops/routing', '/admin/modelops/evals', '/admin/workflows'] },
  { slug: 'finops', nome: 'FinOps', grupo: 'tecnologia', descricao: 'Orçamento, consumo, forecast e kill switch.', funcoes: ['Reservado × real', 'Forecast e alertas', 'Kill switch'], roles: ADMIN, flag: 'modelosHabilitados', implementado: false, rotasBlueprint: ['/admin/finops'] },
  { slug: 'auditoria', nome: 'Auditoria', grupo: 'tecnologia', descricao: 'Trilha de ações, trust e integrações.', funcoes: ['Trilha de ações por identidade', 'Fact check, licenças e LGPD', 'Integrações e credenciais mascaradas'], roles: ADMIN, implementado: false, rotasBlueprint: ['/admin/trust', '/admin/integrations'] },
  { slug: 'configuracoes', nome: 'Configurações', grupo: 'administracao', descricao: 'Domínio, identidade, segredos por referência, retenção e políticas.', funcoes: ['Domínio e identidade', 'Segredos por referência', 'Retenção e backup'], roles: ADMIN, implementado: false },
  { slug: 'permissoes', nome: 'Permissões', grupo: 'administracao', descricao: 'Papéis, MFA e matriz de acesso.', funcoes: ['Papéis e usuários', 'MFA', 'Matriz de acesso por módulo'], roles: ADMIN, implementado: false },
];

export function findModule(slug: string): StudioModule | undefined {
  return MODULES.find((m) => m.slug === slug);
}

export type AccessResult = { ok: true } | { ok: false; reason: 'NO_SESSION' | 'NO_MFA' | 'FORBIDDEN' };

/** Negar por padrão: sem sessão, sem MFA ou sem papel listado, o acesso é recusado. */
export function checkAccess(session: Session | null, allowed: readonly Role[]): AccessResult {
  if (!session) return { ok: false, reason: 'NO_SESSION' };
  if (!session.mfa) return { ok: false, reason: 'NO_MFA' };
  if (!session.roles.some((r) => allowed.includes(r))) return { ok: false, reason: 'FORBIDDEN' };
  return { ok: true };
}

export function canAccessModule(session: Session | null, mod: StudioModule): boolean {
  return checkAccess(session, mod.roles).ok;
}

export function visibleModules(session: Session | null): StudioModule[] {
  return MODULES.filter((m) => canAccessModule(session, m));
}
