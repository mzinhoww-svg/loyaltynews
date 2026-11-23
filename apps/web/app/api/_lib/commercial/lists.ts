// Listas do Studio comercial (pedidas pelo Studio aec1612): campanhas e contas/anunciantes, paginadas e somente leitura.
// Funções puras sobre o contexto do módulo Comercial (mesmo padrão `define`: sessão com MFA + papel comercial, zod, erro em envelope).
// Chaves em inglês, como o resto da API comercial (`campaignDetail`): id, name, status, formatId/formatName, startDate/endDate.
// Nada de dado pessoal: conta devolve contagens, nunca contato dos leads.
import { z } from 'zod';
import { define, ok } from '@ln/commercial/api';
import type { CampaignStatus } from '@ln/commercial';

const STATUS = ['draft', 'reserved', 'approved', 'active', 'paused', 'completed', 'cancelled'] as const satisfies readonly CampaignStatus[];
const Paging = { limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) };
const Q = z.string().trim().min(1).max(100);

const page = <T>(all: T[], limit: number, offset: number) => ({ data: all.slice(offset, offset + limit), total: all.length, limit, offset });

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => { const t = new Date(`${v}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v; }, 'data inexistente');

/** Campanhas: id, nome, estado, formato, posições, período e conta. Filtros: estado (`status`), `accountId`, `q` (nome contém),
 *  período por SOBREPOSIÇÃO (`from`/`to`, AAAA-MM-DD: entra se início ≤ to e fim ≥ from) e `positionId` (uma das posições). Mais recentes primeiro. */
export const listCampaigns = define(
  {
    auth: 'studio',
    schema: z
      .object({ status: z.enum(STATUS).optional(), accountId: z.string().min(1).max(64).optional(), q: Q.optional(), from: Day.optional(), to: Day.optional(), positionId: z.string().min(1).max(32).optional(), ...Paging })
      .refine((i) => !i.from || !i.to || i.from <= i.to, { message: 'from posterior a to', path: ['to'] }),
  },
  (ctx, i) => {
    const q = i.q?.toLowerCase();
    const positionsOf = (c: { positionIds?: string[]; positionId: string | null }) => c.positionIds ?? (c.positionId ? [c.positionId] : []);
    const rows = ctx.campaigns
      .list()
      .filter((c) => (!i.status || c.status === i.status) && (!i.accountId || c.accountId === i.accountId) && (!q || c.name.toLowerCase().includes(q)))
      .filter((c) => (!i.to || c.startDate <= i.to) && (!i.from || c.endDate >= i.from))
      .filter((c) => !i.positionId || positionsOf(c).includes(i.positionId))
      .sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : a.id < b.id ? -1 : 1))
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        formatId: c.formatId,
        formatName: ctx.catalog.find((f) => f.id === c.formatId)?.name ?? null,
        positionId: c.positionId,
        positions: positionsOf(c),
        startDate: c.startDate,
        endDate: c.endDate,
        accountId: c.accountId,
        accountName: ctx.crm.accounts.get(c.accountId)?.name ?? null,
        sponsoredLabel: c.sponsoredLabel,
      }));
    return ok(page(rows, i.limit, i.offset));
  },
);

/** Contas/anunciantes: id, nome, criação e contagens (leads, oportunidades, campanhas e campanhas ativas). Filtro `q` (nome contém). Por nome. */
export const listAccounts = define({ auth: 'studio', schema: z.object({ q: Q.optional(), ...Paging }) }, (ctx, i) => {
  const q = i.q?.toLowerCase();
  const campaigns = ctx.campaigns.list();
  const opps = [...ctx.crm.opportunities.values()];
  const rows = [...ctx.crm.accounts.values()]
    .filter((a) => !q || a.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || (a.id < b.id ? -1 : 1))
    .map((a) => ({
      id: a.id,
      name: a.name,
      createdAt: a.createdAt,
      leads: a.leadIds.length,
      opportunities: opps.filter((o) => o.accountId === a.id).length,
      campaigns: campaigns.filter((c) => c.accountId === a.id).length,
      activeCampaigns: campaigns.filter((c) => c.accountId === a.id && c.status === 'active').length,
    }));
  return ok(page(rows, i.limit, i.offset));
});
