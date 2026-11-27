import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { findModule } from '@/lib/studio/modules';
import { ROTULO_CRITERIO, ROTULO_ESTADO } from '@/lib/studio/piloto-view';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { fixarMapaAction } from './actions';
import { QuadroRolavel } from '../../_components/QuadroRolavel';
import { Recarregar } from '../../_components/Recarregar';

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
        Critério do piloto: <strong>0 fato de gravidade alta</strong> nas 10 matérias e <strong>no máximo 1 de gravidade média</strong>; baixas só anotadas. O QA 3 lê
        as matérias a1, a4, a6 e a9 pela folha do piloto.
      </div>
    </>
  );
}

export default async function PilotoPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  await requireModule(findModule('piloto')!);
  const b = await searchParams;
  const r = await api.piloto.materias();
  if (naoConfigurado(r)) return (<><Intro /><SemBanco modulo="A leitura do piloto" /></>);
  if (ehErro(r)) return (<><Intro /><div className="st-alert err" role="alert">{mensagemErro(r)}<Recarregar /></div></>);
  const itens = r.body.items;
  const f = r.body.fechamento;
  const semMapa = itens.filter((i) => !i.articleId);
  return (
    <>
      <Intro />
      <Flash tipo={b.tipo} aviso={b.aviso} />
      {semMapa.length === itens.length ? (
        <section className="st-empty" aria-labelledby="nao-executado" data-estado="piloto-nao-executado">
          <h2 id="nao-executado">Piloto ainda não executado</h2>
          <p>Nenhuma matéria do piloto foi ligada a um rascunho. Depois da rodada, o operador do piloto fixa o mapa abaixo, a partir da planilha do AgentOps.</p>
        </section>
      ) : null}
      {f ? (
        <section className="st-card" aria-labelledby="fechamento" data-criterio={f.criterio} style={{ marginTop: 14 }}>
          <h2 id="fechamento" style={{ marginTop: 0 }}>
            Resultado do critério: {ROTULO_CRITERIO[f.criterio]}
          </h2>
          <p data-total>
            {f.lidas} de 10 lidas por você · {f.unsupportedFacts} fato(s) não suportado(s): {f.altas} alta(s), {f.medias} média(s), {f.baixas} baixa(s).
          </p>
          {f.divergencias.length ? (
            <p data-divergencias>
              Divergência com o QA 3 em {f.divergencias.join(', ')}: a decisão é sua.
            </p>
          ) : null}
        </section>
      ) : null}
      <QuadroRolavel rotulo="Matérias do piloto">
      <table className="st-table" style={{ marginTop: 14 }}>
        <thead>
          <tr>
            <th scope="col">Matéria</th>
            <th scope="col">Fonte</th>
            <th scope="col">Estado</th>
            <th scope="col">QA 3 (leitor 2)</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((m) => (
            <tr key={m.materia} data-materia={m.materia} data-estado={m.estado}>
              <td>{m.articleId ? <Link href={`/studio/piloto/${m.materia}`}>{m.materia}</Link> : m.materia}</td>
              <td>{m.fonte?.nome ?? <span className="st-hint">—</span>}</td>
              <td>{ROTULO_ESTADO[m.estado]}</td>
              <td>{m.leitor2 ? (m.leituras.leitor2 ? 'registrou' : 'ainda não registrou') : <span className="st-hint">não lê</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </QuadroRolavel>
      <p style={{ marginTop: 10 }}>
        <Link href="/studio/piloto/importar">Importar a leitura do QA 3 (folha do leitor 2)</Link>
        {' · '}
        <Link href="/studio/piloto/violacoes">Violações do piloto (só admin resolve)</Link>
      </p>
      <p>
        {/* download (anexo CSV): link comum, não navegação do Next */}
        <a className="st-btn sec" href="/studio/piloto/planilha" download data-exportar>
          Exportar planilha
        </a>{' '}
        <span className="st-hint">CSV com uma linha por tarefa e tentativa, nas colunas do AgentOps; o leitor 2 só sai nas matérias que você já leu.</span>
      </p>
      {semMapa.length ? (
        <form action={fixarMapaAction} className="st-card" style={{ marginTop: 14 }} aria-label="Fixar mapa do piloto">
          <h2 style={{ marginTop: 0 }}>Ligar matérias aos rascunhos</h2>
          <p className="st-hint">Para o operador do piloto, depois da rodada: informe o id do artigo de cada matéria, conforme a planilha do AgentOps. O mapa não pode ser alterado depois.</p>
          <div className="st-row" style={{ flexWrap: 'wrap' }}>
            {semMapa.map((m) => (
              <div className="st-field" key={m.materia}>
                <label htmlFor={`mapa-${m.materia}`}>Artigo de {m.materia}</label>
                <input id={`mapa-${m.materia}`} name={m.materia} type="text" maxLength={128} />
              </div>
            ))}
          </div>
          <div className="st-field">
            <label>
              <input type="checkbox" name="confirmo" value="sim" /> Confirmo o mapa: ele não pode ser alterado depois
            </label>
          </div>
          <button className="st-btn" type="submit">
            Fixar mapa
          </button>
        </form>
      ) : null}
    </>
  );
}
