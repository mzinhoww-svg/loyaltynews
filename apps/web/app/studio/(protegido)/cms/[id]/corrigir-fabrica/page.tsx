import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FLAG_DEFAULTS } from '@ln/contracts';
import { getDeps } from '@/app/api/_lib/deps';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { TIPOS_CHECAGEM } from '@/lib/studio/cms/status';
import { CMS_REVIEW } from '@/lib/studio/cms/roles';
import { modeloDaChecagem, modeloDoRascunho, type RevisaoFabrica } from '@/lib/studio/cms/fabrica-correcao';
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
  const m = await api.materias.obter(id);
  if (naoConfigurado(m)) return <SemBanco modulo="A correção de matéria" />;
  if (m.status === 404) notFound();
  if (ehErro(m)) throw new Error(mensagemErro(m));
  const materia = m.body.data;
  const volta = (
    <p>
      <Link href={`/studio/cms/${encodeURIComponent(id)}`}>← Matéria</Link>
    </p>
  );
  if (materia.status !== 'publicado' && materia.status !== 'corrigido') {
    return (
      <>
        {volta}
        <h1>Correção de matéria da Fábrica</h1>
        <p className="st-hint" data-situacao="nao-publicada">
          Só matéria publicada é corrigida (esta está em {materia.status}).
        </p>
      </>
    );
  }
  const rev = await api.editorial.revisao(id);
  if (rev.status === 404) {
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
  if (ehErro(rev)) throw new Error(mensagemErro(rev));
  const revisao = rev.body as unknown as RevisaoFabrica;
  const casosResp = await api.editorial.correcoes({});
  const casos = (casosResp && !ehErro(casosResp) ? ((casosResp.body as { items: { id: string; articleId: string; kind: string; state: string }[] }).items ?? []) : []).filter((c) => c.articleId === id && ACEITOS.includes(c.state));
  const ligada = (getDeps()?.flags ?? FLAG_DEFAULTS).publicacaoPortal === true;
  const base = (process.env.PORTAL_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
  const inicial = {
    casoId: casos[0]?.id ?? '',
    draft: JSON.stringify(modeloDoRascunho(materia, revisao), null, 2),
    factcheck: JSON.stringify(modeloDaChecagem((revisao.rascunho?.claims ?? []).map((c) => c.id)), null, 2),
    url: base ? `${base}/noticia/${materia.slug}` : '',
  };
  return (
    <>
      {volta}
      <h1>Correção de matéria da Fábrica</h1>
      <p>
        {materia.titulo} · {materia.status} · v{materia.versao}
      </p>
      <Flash tipo={tipo} aviso={aviso} />
      <p className="st-hint">
        A matéria da Fábrica não é corrigida por edição direta: o texto corrigido é um novo rascunho editorial, com checagem de outro provedor. O recibo da versão corrigida e a publicação oficial recebem o mesmo <code>correcao</code>. O modelo abaixo traz só o que as rotas de leitura expõem; o que falta (id do rascunho, classe de dado, provedor e prompt do modelo, provedor da checagem e vereditos) fica em branco para você preencher, e o Backend recusa o que estiver errado.
      </p>
      {!ligada ? <div className="st-alert" role="status">Publicação desligada neste ambiente (flag publicacaoPortal): o recibo pode ser emitido, a publicação será recusada.</div> : null}
      {casos.length === 0 ? (
        <p className="st-hint" data-casos="0">
          Nenhum caso de correção aceito para esta matéria. <Link href="/studio/cms/correcoes">Abra e conduza um caso em Correções.</Link>
        </p>
      ) : null}
      <CorrecaoFabricaForm id={id} casos={casos} inicial={inicial} checagens={TIPOS_CHECAGEM} />
    </>
  );
}
