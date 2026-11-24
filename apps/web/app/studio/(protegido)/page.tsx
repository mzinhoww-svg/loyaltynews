import type { Metadata } from 'next';
import Link from 'next/link';
import { flagAtiva } from '@/lib/studio/flags';
import { KpiCard } from '@ln/ui';
import { GRUPOS, visibleModules } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, naoConfigurado } from '@/lib/studio/backend';
import { STATUS_LABEL } from '@/lib/studio/cms/status';
import { requireStudio } from '../_lib/guard';

export const metadata: Metadata = { title: 'Visão geral' };
export const dynamic = 'force-dynamic';

export default async function StudioHome() {
  const { session } = await requireStudio(['admin', 'editor_chefe', 'editor', 'revisor', 'comercial', 'leitor']);
  const mods = visibleModules(session);
  const estados = ['rascunho', 'em_checagem', 'bloqueado', 'aprovado'] as const;
  const contagens = await Promise.all(estados.map((s) => api.materias.listar({ status: s })));
  const semBanco = contagens.some((c) => naoConfigurado(c));
  const porStatus = estados.map((s, i) => ({ s, n: ehErro(contagens[i]!) ? null : (contagens[i]!.body as { total: number }).total }));
  return (
    <>
      <h1>LN Studio</h1>
      <p className="st-hint">Painel administrativo do Loyalty News. Módulos sem backend mostram uma tela sem dados: nenhum número aqui é estimado ou fictício.</p>

      <h2>Fila editorial</h2>
      <div className="st-grid" aria-label="Contagem da fila editorial">
        {porStatus.map(({ s, n }) => (
          <KpiCard key={s} label={STATUS_LABEL[s]} value={n} source="CMS (PostgreSQL, rota /api/materias)" period="estado atual" headingLevel={3} />
        ))}
      </div>
      {semBanco ? (
        <p className="st-hint" role="note">
          Banco de dados não configurado neste ambiente: contagens indisponíveis (nunca estimadas).
        </p>
      ) : null}
      <p className="st-hint">Audiência, receita e custos: não disponível.</p>

      <h2>Módulos</h2>
      <div className="st-grid">
        {mods.map((m) => (
          <div className="st-card" key={m.slug}>
            <h3 style={{ marginTop: 0 }}>
              <Link href={`/studio/${m.slug}`}>{m.nome}</Link>
            </h3>
            <p className="st-hint">{GRUPOS[m.grupo]}</p>
            <p>{m.descricao}</p>
            <p>
              <span className="st-badge" data-estado-modulo={m.flag && !flagAtiva(m.flag) ? 'desligado' : m.implementado ? 'em-uso' : 'sem-dados'}>
                {m.flag && !flagAtiva(m.flag) ? 'Desligado nesta fase' : m.implementado ? 'Em uso' : 'Sem dados ainda'}
              </span>
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
