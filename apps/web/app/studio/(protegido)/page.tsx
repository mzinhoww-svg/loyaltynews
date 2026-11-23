import type { Metadata } from 'next';
import Link from 'next/link';
import { isEnabled } from '@ln/contracts';
import { KpiCard } from '@ln/ui';
import { GRUPOS, visibleModules } from '@/lib/studio/modules';
import { getCmsService, STATUS_LABEL } from '@/lib/studio/cms/articles';
import { requireStudio } from '../_lib/guard';

export const metadata: Metadata = { title: 'Visão geral' };
export const dynamic = 'force-dynamic';

export default async function StudioHome() {
  const { session } = await requireStudio(['admin', 'editor_chefe', 'editor', 'revisor', 'comercial', 'leitor']);
  const mods = visibleModules(session);
  const materias = getCmsService().list();
  const porStatus = (['rascunho', 'em_checagem', 'bloqueado', 'aprovado'] as const).map((s) => ({ s, n: materias.filter((m) => m.status === s).length }));
  return (
    <>
      <h1>LN Studio</h1>
      <p className="st-hint">Painel administrativo do Loyalty News. Módulos sem backend mostram estado vazio honesto: nenhum número aqui é estimado ou fictício.</p>

      <h2>Fila editorial</h2>
      <div className="st-grid" aria-label="Contagem da fila editorial">
        {porStatus.map(({ s, n }) => (
          <KpiCard key={s} label={STATUS_LABEL[s]} value={n} source="CMS do Studio (armazenamento temporário)" period="estado atual" headingLevel={3} />
        ))}
      </div>
      <p className="st-hint">Armazenamento temporário do CMS (sem backend): os dados somem ao reiniciar o servidor. Audiência, receita e custos: não disponível.</p>

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
              <span className="st-badge">{m.implementado ? 'em uso' : 'estado vazio'}</span>{' '}
              {m.flag ? <span className="st-badge">{isEnabled(m.flag) ? `flag ${m.flag} ligada` : `flag ${m.flag} desligada`}</span> : null}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
