import { randomUUID } from 'node:crypto';
import { schema } from '@ln/db';
import { auditIp } from './attempts';
import { isRole } from './rbac';
import type { Db } from './types';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  ip?: string | null;
  detalhe?: unknown;
  at?: Date;
}

const SECRET_KEY = /pass|senha|secret|segredo|token|code|codigo|totp|cookie|authorization|backup/i;

/** Remove qualquer chave com cara de segredo, em qualquer profundidade (a auditoria nunca guarda segredo). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[profundo]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[removido]' : redact(v, depth + 1)]),
    );
  }
  return value;
}

// ---------- barreira de privacidade (LGPD) ----------
// audit_log é append-only: o que entra não sai. TODO escritor da tabela passa por `sanitizeAuditRow` (o teste audit-writers.test.ts reprova escritor novo sem ela),
// e as leituras do Studio passam pela mesma função, para as linhas antigas. As regras são de ESTRUTURA, não de formato de endereço:
//  1. texto com arroba (qualquer grafia Unicode dela, ou %40) sai INTEIRO, em qualquer coluna, chave ou valor: não se tenta achar onde o endereço começa ou acaba;
//  2. campo cujo NOME é de contato sai inteiro, com ou sem arroba (só passam `emailRef` = HMAC e `emailDominio` = domínio);
//  3. colunas categóricas têm contrato fechado: `action` e `resource` só [A-Za-z0-9_.:-]; `actorRole` só os papéis do app e os atores de sistema.
// Limite conhecido: não reconhece endereço disfarçado ("fulana (arroba) dominio") nem nome ou telefone escritos num texto livre sem arroba.

export const EMAIL_REMOVIDO = '[e-mail removido]';
export const CONTATO_REMOVIDO = '[contato removido]';
export const VALOR_INVALIDO = '[valor inválido]';

const ATORES_DE_SISTEMA: ReadonlySet<string> = new Set(['cli', 'worker', 'sistema']);
const CATEGORICO = /^[A-Za-z0-9_.:-]{1,160}$/;
const CHAVE_DE_CONTATO = /mail|contato|contact|telefone|phone|celular|whats/;
const HMAC = /^h1:[0-9a-f]{64}$/;
const DOMINIO = /^[A-Za-z0-9.-]{1,255}$/;

// NFKC leva as variantes de largura total e pequena (U+FF20, U+FE6B) a "@"
const temArroba = (s: string): boolean => s.normalize('NFKC').includes('@') || /%(?:25)*40/.test(s);
const semArroba = (s: string): string => (temArroba(s) ? EMAIL_REMOVIDO : s);

function campo(chave: string, valor: unknown, depth: number): unknown {
  const nome = chave.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (valor === null || !CHAVE_DE_CONTATO.test(nome)) return limpar(valor, depth);
  if (nome === 'emailref' && typeof valor === 'string' && HMAC.test(valor)) return valor;
  if ((nome === 'emaildominio' || nome === 'emaildomain') && typeof valor === 'string' && DOMINIO.test(valor)) return valor;
  return nome.includes('mail') ? EMAIL_REMOVIDO : CONTATO_REMOVIDO;
}

function limpar(valor: unknown, depth: number): unknown {
  if (typeof valor === 'string') return semArroba(valor);
  if (valor === null || typeof valor !== 'object') return valor;
  if (depth > 6) return '[profundo]';
  if (Array.isArray(valor)) return valor.map((v) => limpar(v, depth + 1));
  const usadas = new Set<string>();
  return Object.fromEntries(
    Object.entries(valor as Record<string, unknown>).map(([k, v], i) => {
      let chave = semArroba(k);
      if (usadas.has(chave)) chave = `${chave} ${i}`; // duas chaves removidas não se sobrescrevem
      usadas.add(chave);
      return [chave, campo(k, v, depth + 1)];
    }),
  );
}

/** Exatamente o que o JSON gravaria (inclui `toJSON`), sem segredo e sem contato. */
function detalheSeguro(detalhe: unknown): unknown {
  if (detalhe === undefined) return null;
  const json = JSON.stringify(redact(detalhe));
  return json === undefined ? null : limpar(JSON.parse(json), 0);
}

const categorico = (v: string): string => (CATEGORICO.test(v) ? v : VALOR_INVALIDO);

export interface AuditRow {
  actorId: string | null;
  actorRole: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  detalhe: unknown;
}

/** Colunas de texto do audit_log prontas para gravar (ou para devolver numa leitura). O IP tem tratamento próprio (`auditIp`). */
export function sanitizeAuditRow(e: Pick<AuditEntry, 'actorId' | 'actorRole' | 'action' | 'resource' | 'resourceId' | 'detalhe'>): AuditRow {
  const texto = (v: string | null | undefined): string | null => (v == null ? null : semArroba(String(v)));
  const papel = e.actorRole;
  return {
    actorId: texto(e.actorId),
    actorRole: papel == null ? null : isRole(papel) || ATORES_DE_SISTEMA.has(papel) ? papel : VALOR_INVALIDO,
    action: categorico(String(e.action)),
    resource: categorico(String(e.resource)),
    resourceId: texto(e.resourceId),
    detalhe: detalheSeguro(e.detalhe),
  };
}

export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.insert(schema.auditLog).values({
    ...sanitizeAuditRow(e),
    id: randomUUID(),
    at: e.at ?? new Date(),
    ip: auditIp(e.ip), // LGPD: só o HMAC do IP (h1:<hex>); o log é append-only e o IP cru nunca entra
  });
}
