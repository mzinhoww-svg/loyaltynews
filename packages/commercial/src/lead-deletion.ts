// Exclusão de lead (LGPD) e retenção do descartado. A trilha guarda só HMAC-SHA256 do id do lead, com sal do
// servidor: não há id, nome, e-mail nem qualquer campo pessoal, e não é possível reconstruir o dado apagado.
import { createHmac, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';

export type DeletionOrigin = 'studio' | 'retencao';

export const LEAD_AUDIT_SALT_ENV = 'LN_LEAD_AUDIT_SALT';
/** Menor tamanho aceito para o sal (32 hex é o sugerido; 16 caracteres é o piso). */
export const LEAD_AUDIT_SALT_MIN = 16;

/** Sal do servidor. Sem ele a exclusão não acontece: uma trilha sem sal não é segura. */
export function leadAuditSalt(env: Record<string, string | undefined> = process.env): string {
  const v = (env[LEAD_AUDIT_SALT_ENV] ?? '').trim();
  if (v.length < LEAD_AUDIT_SALT_MIN) {
    throw new Error(`${LEAD_AUDIT_SALT_ENV} ausente ou com menos de ${LEAD_AUDIT_SALT_MIN} caracteres: sem sal do servidor não há trilha segura de exclusão`);
  }
  return v;
}

/** HMAC-SHA256 do id com o sal do servidor, em hex. Determinístico para o mesmo sal; não reversível sem a chave. */
export function leadRefHash(leadId: string, salt: string): string {
  return createHmac('sha256', salt).update(leadId, 'utf8').digest('hex');
}

export interface DeletionMeta {
  at: Date;
  actorId: string | null;
  actorRole: string | null;
  origin: DeletionOrigin;
}

/**
 * Apaga os leads DENTRO da transação recebida: solta a referência da oportunidade (a oportunidade é da conta,
 * não do lead), grava a trilha e apaga crm_leads. Devolve quantas linhas saíram.
 */
export async function deleteLeadRows(tx: Db, ids: string[], meta: DeletionMeta, salt: string): Promise<number> {
  if (!ids.length) return 0;
  await tx.update(schema.crmOpportunities).set({ leadId: null }).where(inArray(schema.crmOpportunities.leadId, ids));
  await tx.insert(schema.commercialLeadDeletions).values(
    ids.map((id) => ({
      id: randomUUID(), leadRefHash: leadRefHash(id, salt), at: meta.at,
      actorId: meta.actorId, actorRole: meta.actorRole, origin: meta.origin,
    })),
  );
  const rows = await tx.delete(schema.crmLeads).where(inArray(schema.crmLeads.id, ids)).returning({ id: schema.crmLeads.id });
  return rows.length;
}

/** Exclusão de UM lead pela rota do Studio. Devolve null quando o lead não existe (nada é gravado). */
export async function deleteLeadById(tx: Db, leadId: string, meta: DeletionMeta, salt: string): Promise<{ refHash: string } | null> {
  const [lead] = await tx.select({ id: schema.crmLeads.id }).from(schema.crmLeads).where(eq(schema.crmLeads.id, leadId)).for('update');
  if (!lead) return null;
  const hash = leadRefHash(leadId, salt);
  await tx.update(schema.crmOpportunities).set({ leadId: null }).where(eq(schema.crmOpportunities.leadId, leadId));
  await tx.insert(schema.commercialLeadDeletions).values({ id: randomUUID(), leadRefHash: hash, at: meta.at, actorId: meta.actorId, actorRole: meta.actorRole, origin: meta.origin });
  await tx.delete(schema.crmLeads).where(eq(schema.crmLeads.id, leadId));
  return { refHash: hash };
}

export interface RetentionResult {
  /** Leads apagados nesta rodada. */
  deleted: number;
  /** Data de corte aplicada (o que for MAIS ANTIGO que ela sai). */
  cutoff: string;
}

/**
 * Retenção do descartado: apaga lead com status `descartado` há MAIS de `days` dias. A seleção roda na mesma
 * transação com `FOR UPDATE SKIP LOCKED`, então duas execuções não apagam nem auditam o mesmo lead duas vezes.
 */
export async function retainDiscardedLeads(
  db: Db,
  opts: { now: Date; days: number; salt: string; limit?: number },
): Promise<RetentionResult> {
  if (!Number.isInteger(opts.days) || opts.days < 1) throw new Error('dias de retenção inválidos');
  const cutoff = new Date(opts.now.getTime() - opts.days * 86_400_000);
  const deleted = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const due = await t
      .select({ id: schema.crmLeads.id })
      .from(schema.crmLeads)
      .where(and(eq(schema.crmLeads.status, 'descartado'), isNotNull(schema.crmLeads.descartadoEm), lt(schema.crmLeads.descartadoEm, cutoff)))
      .limit(opts.limit ?? 500)
      .for('update', { skipLocked: true });
    return deleteLeadRows(t, due.map((d) => d.id), { at: opts.now, actorId: null, actorRole: 'sistema', origin: 'retencao' }, opts.salt);
  });
  return { deleted, cutoff: cutoff.toISOString() };
}
