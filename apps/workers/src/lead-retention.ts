// Retenção do lead descartado (LGPD, decisão do PM/Proprietário): apaga crm_leads com status `descartado`
// há MAIS de N dias (padrão 30, LN_LEAD_RETENTION_DAYS). Roda na subida e uma vez por dia. A trilha grava só
// HMAC do id com sal do servidor; sem LN_LEAD_AUDIT_SALT a rotina NÃO apaga (falha fechada, um aviso no log).
import { errLine } from '@ln/db/safe-log';
import type { Db } from '@ln/auth';
import { LEAD_AUDIT_SALT_ENV, leadAuditSalt, retainDiscardedLeads } from '@ln/commercial';

export const DEFAULT_RETENTION_DAYS = 30;
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Dias de guarda do descartado: inteiro >= 1 por env; ausente ou inválido usa 30. */
export function retentionDays(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.LN_LEAD_RETENTION_DAYS ?? '').trim();
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_RETENTION_DAYS;
}

export interface LeadRetention {
  days: number;
  run(): Promise<{ deleted: number; cutoff: string } | null>;
  stop(): void;
}

/**
 * Liga a rotina. Devolve null (com um aviso) quando falta o sal: sem sal não há trilha segura, então é melhor
 * não apagar. Erro de banco não derruba o worker; fica no log saneado e a próxima rodada tenta de novo.
 */
export function startLeadRetention(opts: {
  db: Db;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  log?: (line: string) => void;
  intervalMs?: number;
  /** Só testes: não dispara a rodada inicial. */
  runOnStart?: boolean;
}): LeadRetention | null {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((l: string) => console.log(l));
  let salt: string;
  try {
    salt = leadAuditSalt(env);
  } catch {
    log(`[lead-retention] desligada: ${LEAD_AUDIT_SALT_ENV} ausente ou curta; sem sal não há trilha segura e nada será apagado`);
    return null;
  }
  const days = retentionDays(env);
  const now = opts.now ?? (() => new Date());
  const run = async () => {
    try {
      const r = await retainDiscardedLeads(opts.db, { now: now(), days, salt });
      log(`[lead-retention] descartados há mais de ${days} dias: ${r.deleted} apagado(s)`);
      return r;
    } catch (e) {
      log(errLine('[lead-retention] falhou (nada além da transação foi alterado; a próxima rodada tenta de novo)', e));
      return null;
    }
  };
  if (opts.runOnStart !== false) void run();
  const timer = setInterval(() => void run(), opts.intervalMs ?? RETENTION_INTERVAL_MS);
  timer.unref?.();
  return { days, run, stop: () => clearInterval(timer) };
}

