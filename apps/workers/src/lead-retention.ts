// Retenção do lead comercial (DP-55, decisão do proprietário): lead NÃO convertido some 12 meses depois do último contato; lead descartado, 30 dias depois do
// descarte. Apagamento automático, por job do worker (subida e a cada 6 h). Dono: Frente 02 — LN Backend Engineer.
//  - "Convertido" = tem conta (conta_id) ou status `convertido`: NUNCA é apagado aqui (segue o contrato e as obrigações legais).
//  - ultimo_contato_em e descartado_em são mantidos por gatilho do banco (migração 0031): captura, mudança do lead e mudança da oportunidade ligada a ele.
//  - Cascata: crm_opportunities.conta_id é obrigatório, então nenhuma oportunidade é "só do lead": o vínculo (lead_id) é desfeito e a oportunidade e a conta ficam.
//  - Auditoria (uma linha por rodada que apagou algo) SÓ com contagens (nunca nome, e-mail, empresa ou id de lead). Nada é logado além das contagens.
//  - Tudo numa transação: ou apaga e audita, ou nada.
import { sql } from 'drizzle-orm';
import { audit } from '@ln/auth';
import type { Db } from '@ln/auth';

export const NAO_CONVERTIDO_MESES = 12;
export const DESCARTADO_DIAS = 30;

export interface LeadRetentionResult { naoConvertidos: number; descartados: number; vinculosDesfeitos: number }

export async function purgeLeads(db: Db, now: Date = new Date()): Promise<LeadRetentionResult> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // candidatos: sem conta e não convertidos; (12 meses sem contato) OU (descartado há mais de 30 dias). Fronteira exclusiva: "há mais de".
    const cand = await t.execute(sql`
      SELECT id, (descartado_em IS NOT NULL AND descartado_em < ${now}::timestamptz - make_interval(days => ${DESCARTADO_DIAS})) AS por_descarte
      FROM crm_leads
      WHERE conta_id IS NULL AND status <> 'convertido'
        AND (ultimo_contato_em < ${now}::timestamptz - make_interval(months => ${NAO_CONVERTIDO_MESES})
             OR (status = 'descartado' AND descartado_em < ${now}::timestamptz - make_interval(days => ${DESCARTADO_DIAS})))
      FOR UPDATE`);
    const rows = cand.rows as Array<{ id: string; por_descarte: boolean }>;
    if (rows.length === 0) {
      return { naoConvertidos: 0, descartados: 0, vinculosDesfeitos: 0 };
    }
    const ids = rows.map((r) => r.id);
    const idList = sql.join(ids.map((i) => sql`${i}`), sql`, `);
    const unl = await t.execute(sql`UPDATE crm_opportunities SET lead_id = NULL WHERE lead_id IN (${idList}) RETURNING id`);
    await t.execute(sql`DELETE FROM crm_leads WHERE id IN (${idList})`);
    const descartados = rows.filter((r) => r.por_descarte).length;
    const out: LeadRetentionResult = { naoConvertidos: rows.length - descartados, descartados, vinculosDesfeitos: unl.rows.length };
    await audit(t, { actorId: 'lead-retention', actorRole: 'worker', action: 'crm.leads_retencao', resource: 'crm', resourceId: 'leads', detalhe: { ...out }, at: now });
    return out;
  });
}

export function startLeadRetention(o: { db: Db; intervalMs?: number; now?: () => Date; onResult?: (r: LeadRetentionResult) => void; onError?: (e: unknown) => void }): { stop(): void; tick(): Promise<void> } {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const r = await purgeLeads(o.db, (o.now ?? (() => new Date()))());
      o.onResult?.(r);
    } catch (e) {
      o.onError?.(e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), o.intervalMs ?? 6 * 3_600_000);
  timer.unref?.();
  void tick();
  return { tick, stop: () => clearInterval(timer) };
}
