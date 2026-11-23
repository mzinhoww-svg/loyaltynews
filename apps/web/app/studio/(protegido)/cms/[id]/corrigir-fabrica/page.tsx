import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FLAG_DEFAULTS } from '@ln/contracts';
import { getDeps } from '@/app/api/_lib/deps';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { TIPOS_CHECAGEM } from '@/lib/studio/cms/status';
import { CMS_REVIEW } from '@/lib/studio/cms/roles';
import { edicaoInicial } from '@/lib/studio/cms/fabrica-correcao';
import { requireStudio } from '../../../../_lib/guard';
import { Flash } from '../../../../_components/Flash';
import { SemBanco } from '../../../../_components/SemBanco';
import { CorrecaoFabricaForm } from './CorrecaoFabricaForm';

export const metadata: Metadata = { title: 'Correção de matéria da Fábrica' };
export const dynamic = 'force-dynamic';

const ACEITOS = ['accepted', 'escalated_legal', 'notice_published', 'social_reconciled'];

export default async function CorrigirFabrica({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  await requireStudio(CMS_REVIEW);
  const id = decodeURIComponent((await params).id);
  const { tipo, aviso } = await searchParams;
  const volta = (
    <p>
      <Link href={`/studio/cms/${encodeURIComponent(id)}`}>← Matéria</Link>
    </p>
  );
  // rascunho completo + última checagem (404 = a matéria não tem registro na Fábrica)
  const r = await api.editorial.rascunho(id);
  if (naoConfigurado(r)) return <SemBanco modulo="A correção de matéria" />;
  if (r.status === 404) {
    const m = await api.materias.obter(id);
    if (!ehErro(m) || m.status !== 404) {
      return (
        <>
          {volta}
          <h1>Correção de matéria da Fábrica</h1>
          <p className="st-hint" data-situacao="nao-fabrica">
            Esta matéria não tem registro na Fábrica editorial: ela é corrigida pela seção Correção da própria matéria (revisão com caso aceito).
          </p>
        </>
      );
    }
    notFound();
  }
  if (ehErro(r)) throw new Error(mensagemErro(r));
  const base = r.body;
  if (!base.podeCorrigir) {
    return (
      <>
        {volta}
        <h1>Correção de matéria da Fábrica</h1>
        <p className="st-hint" data-situacao="nao-publicada">
          Só matéria publicada é corrigida (esta está em {base.status}).
        </p>
      </>
    );
  }
  const casosResp = await api.editorial.correcoes({});
  const casos = (!ehErro(casosResp) ? ((casosResp.body as { items: { id: string; articleId: string; kind: string; state: string }[] }).items ?? []) : []).filter((c) => c.articleId === id && ACEITOS.includes(c.state));
  const ligada = (getDeps()?.flags ?? FLAG_DEFAULTS).publicacaoPortal === true;
  const urlBase = (process.env.PORTAL_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
  const d = base.rascunho;
  const inicial = { ...edicaoInicial(base, casos[0]?.id ?? ''), url: urlBase ? `${urlBase}/noticia/${d.slug}` : (base.publicacao?.url ?? '') };
  const fixos = [
    { rotulo: 'Rascunho', valor: d.id },
    { rotulo: 'Slug (imutável)', valor: String(d.slug) },
    { rotulo: 'Editoria', valor: String(d.editoria) },
    { rotulo: 'Tipo de conteúdo', valor: String(d.tipoConteudo) },
    { rotulo: 'Classe de dado', valor: String(d.classeDeDado) },
    { rotulo: 'Redigido por', valor: `${String(d.modelProvider)} (prompt ${String(d.promptVersion)})` },
    { rotulo: 'Assinatura', valor: String(d.signature) },
    { rotulo: 'Evidências', valor: (d.evidenceIds as string[]).join(', ') || '—' },
  ];
  return (
    <>
      {volta}
      <h1>Correção de matéria da Fábrica</h1>
      <p>
        {d.headline} · {base.status} · v{base.versaoPublicada ?? '?'}
      </p>
      <Flash tipo={tipo} aviso={aviso} />
      <p className="st-hint">
        A matéria da Fábrica não é corrigida por edição direta: o texto corrigido é um novo rascunho editorial, com checagem de outro provedor. O recibo da versão corrigida e a publicação oficial recebem o mesmo <code>correcao</code>, montado a partir do rascunho completo que o Backend devolve; você edita o texto e a checagem.
      </p>
      {base.avisos.length > 0 ? (
        <section aria-label="Avisos já publicados">
          <h2>Avisos já publicados (permanecem no corpo)</h2>
          <ul className="st-issues">
            {base.avisos.map((a) => (
              <li key={a.caseId}>
                {a.em.slice(0, 10)} · {a.tipo}: {a.texto}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!ligada ? (
        <div className="st-alert" role="status">
          Publicação desligada neste ambiente (flag publicacaoPortal): o recibo pode ser emitido, a publicação será recusada.
        </div>
      ) : null}
      {casos.length === 0 ? (
        <p className="st-hint" data-casos="0">
          Nenhum caso de correção aceito para esta matéria. <Link href="/studio/cms/correcoes">Abra e conduza um caso em Correções.</Link>
        </p>
      ) : null}
      <CorrecaoFabricaForm
        id={id}
        casos={casos}
        inicial={inicial}
        afirmacoes={d.claims.map((c) => ({ id: c.id, kind: c.kind, textoOriginal: c.text }))}
        fixos={fixos}
        checagens={TIPOS_CHECAGEM}
      />
    </>
  );
}
