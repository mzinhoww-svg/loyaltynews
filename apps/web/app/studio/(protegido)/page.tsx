import type { Metadata } from 'next';
import Link from 'next/link';
import { flagAtiva } from '@/lib/studio/flags';
import { KpiCard, StatusPill } from '@ln/ui';
import { GRUPOS, checkAccess, visibleModules, type GrupoId } from '@/lib/studio/modules';
import { CMS_EDIT } from '@/lib/studio/cms/roles';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, naoConfigurado } from '@/lib/studio/backend';
import { STATUS_LABEL } from '@/lib/studio/cms/status';
import { requireStudio } from '../_lib/guard';
import { Recarregar } from '../_components/Recarregar';

export const metadata: Metadata = { title: 'Visão geral' };
export const dynamic = 'force-dynamic';

export default async function StudioHome() {
  const { session } = await requireStudio(['admin', 'editor_chefe', 'editor', 'revisor', 'comercial', 'leitor']);
  const mods = visibleModules(session);
  const visiveis = new Set(mods.map((m) => m.slug));
  // atalhos para o que mais se faz; cada um só aparece para quem tem acesso à área
  const atalhos = [
    ...(checkAccess(session, CMS_EDIT).ok ? [{ href: '/studio/cms/nova', rotulo: 'Nova matéria' }] : []),
    ...(visiveis.has('cms') ? [{ href: '/studio/cms/checagem', rotulo: 'Fila de checagem' }] : []),
    ...(visiveis.has('fontes') ? [{ href: '/studio/fontes/fabrica', rotulo: 'Fontes da Fábrica' }] : []),
    ...(visiveis.has('piloto') ? [{ href: '/studio/piloto', rotulo: 'Leitura do piloto' }] : []),
    { href: '/studio/conta', rotulo: 'Minha conta' },
  ];
  const grupos = (Object.keys(GRUPOS) as GrupoId[]).map((g) => ({ id: g, nome: GRUPOS[g], itens: mods.filter((m) => m.grupo === g) })).filter((g) => g.itens.length > 0);
  const estados = ['rascunho', 'em_checagem', 'bloqueado', 'aprovado'] as const;
  const contagens = await Promise.all(estados.map((s) => api.materias.listar({ status: s })));
  const semBanco = contagens.some((c) => naoConfigurado(c));
  const porStatus = estados.map((s, i) => ({ s, n: ehErro(contagens[i]!) ? null : (contagens[i]!.body as { total: number }).total }));
  return (
    <>
      <h1>LN Studio</h1>
      <p className="st-hint">Visão geral do painel administrativo do Loyalty News: daqui você chega a todas as áreas. Módulos sem backend mostram o que falta: nenhum número aqui é estimado ou fictício.</p>

      <section aria-labelledby="atalhos">
        <h2 id="atalhos">Atalhos</h2>
        <ul className="st-actions" style={{ listStyle: 'none', padding: 0 }} data-atalhos>
          {atalhos.map((a) => (
            <li key={a.href}>
              <Link className="st-btn sec" href={a.href}>
                {a.rotulo}
              </Link>
            </li>
          ))}
        </ul>
      </section>

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
      {contagens.some((c) => ehErro(c)) ? (
        <div className="st-alert err" role="alert">
          Não foi possível ler as contagens da fila editorial. Nenhum número foi estimado.
          <Recarregar />
        </div>
      ) : null}
      <p className="st-hint">Audiência, receita e custos: não disponível.</p>

      <h2>Áreas do Studio</h2>
      {grupos.map((g) => (
        <section key={g.id} aria-labelledby={`grupo-${g.id}`} data-grupo={g.id}>
          <h3 id={`grupo-${g.id}`}>{g.nome}</h3>
          <div className="st-grid">
            {g.itens.map((m) => (
              <div className="st-card" key={m.slug}>
                <h4 style={{ marginTop: 0 }}>
                  <Link href={`/studio/${m.slug}`}>{m.nome}</Link>
                </h4>
                <p>{m.descricao}</p>
                <p>
                  <span data-estado-modulo={m.flag && !flagAtiva(m.flag) ? 'desligado' : m.implementado ? 'em-uso' : 'sem-dados'}>
                    {m.flag && !flagAtiva(m.flag) ? <StatusPill label="Desligado nesta fase" tone="neutral" /> : m.implementado ? <StatusPill label="Em uso" tone="success" /> : <StatusPill label="Sem dados ainda" tone="neutral" />}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
