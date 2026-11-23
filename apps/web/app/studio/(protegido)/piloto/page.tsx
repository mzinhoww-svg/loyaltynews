import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { findModule } from '@/lib/studio/modules';
import { MATERIAS, contar, leituraVigente, resultadoPiloto, type Leitura, type MateriaId, type MateriaPiloto } from '@/lib/studio/piloto-view';
import { requireModule } from '../../_lib/guard';
import { SemBanco } from '../../_components/SemBanco';

export const metadata: Metadata = { title: 'Leitura do piloto' };
export const dynamic = 'force-dynamic';

function Intro() {
  return (
    <>
      <h1>Leitura do piloto</h1>
      <p>
        Leitura rápida das 10 matérias do piloto, poucos minutos cada: o texto, as fontes com link, a checagem, a revisão e os avisos de tom, lado a lado. Marque só
        o fato material que não bate com a evidência. Nada é publicado por esta tela.
      </p>
      <div className="st-alert" role="note" data-aviso="criterio">
        Critério do piloto: <strong>0 fato de gravidade alta</strong> nas 10 matérias e <strong>no máximo 1 de gravidade média</strong>; baixas só anotadas. Achado
        sem gravidade conta como alta. O QA 3 lê as matérias a1, a4, a6 e a9 pela folha; a leitura dele entra depois por importação.
      </div>
    </>
  );
}

export default async function PilotoPage() {
  await requireModule(findModule('piloto')!);
  const r = await api.piloto.materias();
  if (naoConfigurado(r)) return (<><Intro /><SemBanco modulo="A leitura do piloto" /></>);
  if (r.status === 404) {
    return (
      <>
        <Intro />
        <section className="st-empty" aria-labelledby="nao-executado" data-estado="piloto-nao-executado">
          <h2 id="nao-executado">Piloto ainda não executado</h2>
          <p>
            Ainda não há matérias do piloto para ler: o piloto não rodou, e as rotas que ligam cada matéria ao rascunho e guardam a leitura (Editorial e Backend)
            ainda não existem. Quando existirem, as 10 matérias aparecem aqui. Nada é simulado.
          </p>
        </section>
      </>
    );
  }
  if (ehErro(r)) return (<><Intro /><div className="st-alert err" role="alert">{mensagemErro(r)}</div></>);

  const materias = new Map<MateriaId, MateriaPiloto>(r.body.items.map((m) => [m.materia, m]));
  const leituras: Partial<Record<MateriaId, Leitura[]>> = {};
  const erros: string[] = [];
  for (const m of MATERIAS) {
    if (!materias.get(m)?.articleId) continue;
    const l = await api.piloto.leituras(m);
    if (ehErro(l)) erros.push(`${m}: ${mensagemErro(l)}`);
    else leituras[m] = l.body.items;
  }
  const res = resultadoPiloto(leituras);
  return (
    <>
      <Intro />
      {erros.length ? (
        <div className="st-alert err" role="alert">
          Não foi possível ler algumas leituras: {erros.join(' · ')}
        </div>
      ) : null}
      <section className="st-card" aria-labelledby="fechamento" data-resultado={res.estado}>
        <h2 id="fechamento" style={{ marginTop: 0 }}>
          Resultado do critério:{' '}
          {res.estado === 'inconclusivo' ? 'inconclusivo' : res.estado === 'aprovado' ? 'aprovado' : 'reprovado'}
        </h2>
        {res.estado === 'inconclusivo' ? (
          <p data-faltam>
            Faltam {res.faltam.length} {res.faltam.length === 1 ? 'matéria' : 'matérias'} sem leitura do leitor 1 ({res.faltam.join(', ')}). Até agora: {res.parcial.altas}{' '}
            alta(s), {res.parcial.medias} média(s), {res.parcial.baixas} baixa(s).
          </p>
        ) : (
          <p data-total>
            {res.total.unsupported_facts} fato(s) não suportado(s): {res.total.altas} alta(s), {res.total.medias} média(s), {res.total.baixas} baixa(s).
          </p>
        )}
      </section>
      <table className="st-table" aria-label="Matérias do piloto" style={{ marginTop: 14 }}>
        <thead>
          <tr>
            <th scope="col">Matéria</th>
            <th scope="col">Fonte</th>
            <th scope="col">Leitura do leitor 1</th>
            <th scope="col">Leitor 2 (QA 3)</th>
          </tr>
        </thead>
        <tbody>
          {MATERIAS.map((m) => {
            const mp = materias.get(m);
            const l1 = leituraVigente(leituras[m] ?? [], 1);
            const l2 = leituraVigente(leituras[m] ?? [], 2);
            const c = l1 ? contar(l1) : null;
            return (
              <tr key={m} data-materia={m} data-estado={!mp?.articleId ? 'nao-gerada' : l1 ? 'lida' : 'a-ler'}>
                <td>{mp?.articleId ? <Link href={`/studio/piloto/${m}`}>{m}</Link> : m}</td>
                <td>{mp?.fonte ?? <span className="st-hint">—</span>}</td>
                <td>
                  {!mp?.articleId ? (
                    <span className="st-hint">ainda não gerada</span>
                  ) : !l1 ? (
                    <Link href={`/studio/piloto/${m}`}>ler agora</Link>
                  ) : (
                    <>
                      {l1.veredito === 'aprovado' ? 'Aprovada' : 'Bloqueada'} · {c!.altas} alta(s), {c!.medias} média(s), {c!.baixas} baixa(s)
                      {l1.versao > 1 ? <span className="st-hint"> · versão {l1.versao}</span> : null}
                    </>
                  )}
                </td>
                <td>{mp?.leitor2 ? (l2 ? 'importada' : 'pela folha (a importar)') : <span className="st-hint">não lê</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
