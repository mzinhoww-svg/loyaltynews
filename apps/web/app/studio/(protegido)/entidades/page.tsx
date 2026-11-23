import type { Metadata } from 'next';
import Link from 'next/link';
import { isEnabled } from '@ln/contracts';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { bancoOuNulo } from '@/lib/studio/intelligence-db';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { OrigemBanco, SemBanco } from '../../_components/SemBanco';
import { MovesPendentes } from '../../_components/MovesPendentes';

export const metadata: Metadata = { title: 'Entity intelligence' };
export const dynamic = 'force-dynamic';

export default async function EntidadesPage({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('entidades')!);
  const { q = '', tipo, aviso } = await searchParams;
  const pessoasLigadas = isEnabled('intelligencePessoas');
  // origem do banco só para avisar quando é o temporário de dev/e2e; os DADOS vêm das rotas do Backend
  const banco = await bancoOuNulo();
  const termo = q.trim();
  const [emp, pes] = termo ? await Promise.all([api.intelligence.empresas(termo), api.intelligence.executivos(termo)]) : [null, null];
  const semBanco = (emp && naoConfigurado(emp)) || !banco;
  const podeRevisar = checkAccess(session, ['admin', 'editor_chefe', 'editor', 'revisor']).ok;
  return (
    <>
      <h1>Entity intelligence</h1>
      <p>Empresas, relações e cargos com fonte e data de validação. Informação profissional de fonte pública; ausência de registro não prova inexistência. Movimentações só viram fato depois de revisão.</p>
      <div className="st-alert" role="status">
        Ingestão de pessoas (flag intelligencePessoas): <strong>{pessoasLigadas ? 'ligada' : 'desligada'}</strong>.
      </div>
      <Flash tipo={tipo} aviso={aviso} />
      {semBanco ? (
        <SemBanco />
      ) : (
        <>
          <OrigemBanco origem={banco.origem} />
          <form className="st-filters" method="get" role="search" aria-label="Buscar entidades">
            <div className="st-field">
              <label htmlFor="q">Buscar empresa ou executivo</label>
              <input id="q" name="q" type="search" defaultValue={q} />
            </div>
            <button className="st-btn sec" type="submit">
              Buscar
            </button>
          </form>
          {emp && pes ? <Resultados emp={emp} pes={pes} q={termo} /> : <p className="st-hint">Digite um nome para buscar.</p>}

          <section aria-labelledby="a-confirmar" style={{ marginTop: 24 }}>
            <h2 id="a-confirmar">Cargos a confirmar</h2>
            <p className="st-hint" data-lacuna="fila-a-confirmar">
              Cargo vindo de LinkedIn ou de site de organograma fica como <strong>secundária — a confirmar</strong>: nunca vira Move e nunca fecha cargo. Um editor o confirma com a página oficial ou o descarta. Hoje a lista de cargos a confirmar só existe por empresa (abra a empresa para ver os dela): a fila geral e as ações de confirmar e descartar dependem de rotas que o Backend ainda não tem.
            </p>
          </section>

          <MovesPendentes podeRevisar={podeRevisar} retorno="/studio/entidades" />
        </>
      )}
    </>
  );
}

function Resultados({ emp, pes, q }: { emp: Awaited<ReturnType<typeof api.intelligence.empresas>>; pes: Awaited<ReturnType<typeof api.intelligence.executivos>>; q: string }) {
  if (ehErro(emp)) {
    return (
      <div className="st-alert err" role="alert">
        {mensagemErro(emp)}
      </div>
    );
  }
  const empresas = emp.body.items;
  const pessoas = ehErro(pes) ? [] : pes.body.items;
  if (empresas.length === 0 && pessoas.length === 0) {
    return (
      <section className="st-empty" aria-labelledby="sem-res">
        <h2 id="sem-res">Nenhum resultado</h2>
        <p>Nenhum registro para &quot;{q}&quot;. Ausência de registro não prova inexistência.</p>
      </section>
    );
  }
  return (
    <>
      <h2>Empresas ({empresas.length})</h2>
      <ul aria-label="Empresas encontradas">
        {empresas.map((e) => (
          <li key={e.id}>
            <Link href={`/studio/entidades/${e.id}`}>{e.trade_name ?? e.legal_name}</Link> <span className="st-hint">{e.kind}</span>
          </li>
        ))}
      </ul>
      <h2>Executivos ({pessoas.length})</h2>
      <ul aria-label="Executivos encontrados">
        {pessoas.map((p) => (
          <li key={p.id}>
            <Link href={`/studio/entidades/pessoa/${p.id}`}>{p.full_name}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
