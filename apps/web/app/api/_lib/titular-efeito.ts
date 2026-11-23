// Efeito público das decisões da fila do titular (DP-38). Dono: Backend 2 (tabela titular_pedidos).
// Consumido pelas rotas públicas de pessoas/Moves e pelas consultas de Intelligence (Backend 1):
//   - pessoasOcultas: remover_pessoa sobre alvo `pessoa` → perfil 404, fora de listas e de Moves;
//   - cargosOcultos: remover_cargo sobre alvo `cargo` (ou `pessoa` com remover_cargo sem id de cargo: não entra — precisa do id);
//   - movesOcultos: remover_* sobre alvo `move`;
//   - correcoes: corrigir → campos a sobrepor, por `${tipo}:${id}`; vale a decisão mais recente.
// Pedido sem alvo identificado não gera efeito automático (o Studio trata à mão).
import { and, asc, inArray, isNotNull } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';

export interface EfeitosTitular {
  pessoasOcultas: Set<string>;
  cargosOcultos: Set<string>;
  movesOcultos: Set<string>;
  correcoes: Map<string, Record<string, string>>;
}

type Decisao = { acao?: string; campos?: Record<string, string> } | null;

export async function efeitosTitular(db: Db): Promise<EfeitosTitular> {
  const t = schema.titularPedidos;
  const rows = await db
    .select({ alvoTipo: t.alvoTipo, alvoId: t.alvoId, decisao: t.decisao })
    .from(t)
    .where(and(inArray(t.estado, ['corrigido', 'removido']), isNotNull(t.alvoTipo), isNotNull(t.alvoId)))
    .orderBy(asc(t.decididoEm));
  const out: EfeitosTitular = { pessoasOcultas: new Set(), cargosOcultos: new Set(), movesOcultos: new Set(), correcoes: new Map() };
  for (const r of rows) {
    const d = r.decisao as Decisao;
    const id = r.alvoId!;
    if (d?.acao === 'remover_pessoa' && r.alvoTipo === 'pessoa') out.pessoasOcultas.add(id);
    else if (d?.acao === 'remover_cargo' && r.alvoTipo === 'cargo') out.cargosOcultos.add(id);
    else if ((d?.acao === 'remover_pessoa' || d?.acao === 'remover_cargo') && r.alvoTipo === 'move') out.movesOcultos.add(id);
    else if (d?.acao === 'corrigir' && d.campos) out.correcoes.set(`${r.alvoTipo}:${id}`, { ...(out.correcoes.get(`${r.alvoTipo}:${id}`) ?? {}), ...d.campos });
  }
  return out;
}

/** Um pedido específico já tem efeito aplicado pelas rotas públicas? Liga quando o Backend 1 entregar o consumo (EFEITO_APLICADO). */
export const EFEITO_APLICADO = true;
