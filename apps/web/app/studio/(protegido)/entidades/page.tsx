import type { Metadata } from 'next';
import Link from 'next/link';
import { isEnabled } from '@ln/contracts';
import { listMovesHandler, searchCompaniesHandler, searchExecutivesHandler } from '@ln/intelligence';
import { findModule } from '@/lib/studio/modules';
import { bancoOuNulo } from '@/lib/studio/intelligence-db';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { OrigemBanco, SemBanco } from '../../_components/SemBanco';
import { revisarMoveAction } from './actions';

export const metadata: Metadata = { title: 'Entity intelligence' };
export const dynamic = 'force-dynamic';

type Empresa = { id: string; legal_name: string; trade_name: string | null; kind: string };
type Pessoa = { id: string; full_name: string };
type Move = { id: string; status: string; person_name?: string; summary?: string; [k: string]: unknown };

export default async function EntidadesPage({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string; aviso?: string }> }) {
  await requireModule(findModule('entidades')!);
  const { q = '', tipo, aviso } = await searchParams;
  const banco = await bancoOuNulo();
  const pessoasLigadas = isEnabled('intelligencePessoas');
  return (
    <>
      <h1>Entity intelligence</h1>
      <p>Empresas e executivos com fonte e data de validação. Informação profissional de fonte pública; ausência de registro não prova inexistência. Movimentações só viram fato depois de revisão.</p>
      <div className="st-alert" role="status">
        Ingestão de pessoas (flag intelligencePessoas): <strong>{pessoasLigadas ? 'ligada' : 'desligada'}</strong>.
      </div>
      <Flash tipo={tipo} aviso={aviso} />
      {!banco ? (
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
          {q ? <Resultados db={banco.db} q={q} /> : <p className="st-hint">Digite um nome para buscar.</p>}
          <Fila db={banco.db} />
        </>
      )}
    </>
  );
}

async function Resultados({ db, q }: { db: Parameters<typeof searchCompaniesHandler>[0]; q: string }) {
  const emp = await searchCompaniesHandler(db, { q });
  const pes = await searchExecutivesHandler(db, { q });
  const empresas = ((emp.body as { items?: Empresa[] }).items ?? []) as Empresa[];
  const pessoas = ((pes.body as { items?: Pessoa[] }).items ?? []) as Pessoa[];
  const invalido = emp.status >= 400;
  if (invalido) return <div className="st-alert err" role="alert">Busca inválida.</div>;
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
          <li key={p.id}>{p.full_name}</li>
        ))}
      </ul>
    </>
  );
}

async function Fila({ db }: { db: Parameters<typeof listMovesHandler>[0] }) {
  const r = await listMovesHandler(db, 'studio', { status: 'detected', limit: 50 });
  const moves = ((r.body as { items?: Move[] }).items ?? []) as Move[];
  return (
    <section aria-labelledby="fila-moves" style={{ marginTop: 24 }}>
      <h2 id="fila-moves">Fila de revisão de movimentações</h2>
      {moves.length === 0 ? (
        <p className="st-hint" data-vazio="moves">
          Nenhuma movimentação aguardando revisão.
        </p>
      ) : (
        <table className="st-table">
          <thead>
            <tr>
              <th scope="col">Movimentação</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id}>
                <th scope="row">{m.person_name ?? m.id}</th>
                <td>
                  <div className="st-actions">
                    {(['confirmed', 'rejected'] as const).map((s) => (
                      <form action={revisarMoveAction} key={s}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="status" value={s} />
                        <button className={s === 'rejected' ? 'st-btn danger' : 'st-btn'} type="submit" aria-label={`${s === 'confirmed' ? 'Confirmar' : 'Rejeitar'} ${m.person_name ?? m.id}`}>
                          {s === 'confirmed' ? 'Confirmar' : 'Rejeitar'}
                        </button>
                      </form>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
