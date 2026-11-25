import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/studio/rotas-api";
import { ehErro, mensagemErro, naoConfigurado } from "@/lib/studio/backend";
import { findModule } from "@/lib/studio/modules";
import {
  COM_LEITOR_2,
  GRAVIDADE_DO_TIPO,
  ROTULO_GRAVIDADE,
  ROTULO_TIPO,
  TIPOS,
  ehMateria,
  type Leitura,
} from "@/lib/studio/piloto-view";
import { requireModule } from "../../../_lib/guard";
import { Flash } from "../../../_components/Flash";
import { SemBanco } from "../../../_components/SemBanco";
import { registrarLeituraAction } from "../actions";
import { Seta } from '../../../_components/Seta';
import { Recarregar } from '../../../_components/Recarregar';

export const metadata: Metadata = { title: "Leitura do piloto" };
export const dynamic = "force-dynamic";

/** O que GET /api/studio/editorial/articles/:id/review devolve (ReviewView do @ln/editorial), só o que a leitura usa. */
interface Revisao {
  status: string;
  editoria: string;
  rascunho: {
    titulo: string;
    corpo: string;
    assinatura: string;
    claims: {
      id: string;
      kind: string;
      text: string;
      evidenceIds: string[];
      verdict: string | null;
    }[];
  } | null;
  evidencias: {
    id: string;
    url: string;
    capturadoEm: string;
    titulo: string;
    suspeita: boolean;
  }[];
  gate: {
    passou: boolean;
    achados: { code: string; message: string; claimId?: string }[];
    independencia: {
      independent: boolean;
      draftProvider: string | null;
      factcheckProvider: string | null;
    };
    todasClaimsAprovadas: boolean;
  };
  bloqueios: string[];
  revisoes: { decision?: string; note?: string; at?: string; by?: string }[];
  avisosDeTom: { code: string; message: string }[];
}

const ROTULO_VEREDITO: Record<string, string> = {
  pass: "aprovada",
  fail: "reprovada",
  unverifiable: "não verificável",
};
const quando = (iso: string) => iso.slice(0, 16).replace("T", " ");

export default async function LeituraMateriaPage({
  params,
  searchParams,
}: {
  params: Promise<{ materia: string }>;
  searchParams: Promise<{ tipo?: string; aviso?: string }>;
}) {
  await requireModule(findModule("piloto")!);
  const { materia } = await params;
  if (!ehMateria(materia)) notFound();
  const b = await searchParams;
  const voltar = (
    <p>
      <Link href="/studio/piloto"><Seta direcao="esquerda" /> Voltar às 10 matérias</Link>
    </p>
  );
  const titulo = <h1>Leitura do piloto · {materia}</h1>;
  const lista = await api.piloto.materias();
  if (naoConfigurado(lista))
    return (
      <>
        {titulo}
        {voltar}
        <SemBanco modulo="A leitura do piloto" />
      </>
    );
  if (ehErro(lista))
    return (
      <>
        {titulo}
        {voltar}
        <div className="st-alert err" role="alert">
          {mensagemErro(lista)}
          <Recarregar />
        </div>
      </>
    );
  const mp = lista.body.items.find((m) => m.materia === materia);
  if (!mp?.articleId) {
    return (
      <>
        {titulo}
        {voltar}
        <section className="st-empty" data-estado="piloto-nao-executado">
          <p style={{ margin: 0 }}>
            Piloto ainda não executado para {materia}: nenhuma matéria gerada
            foi ligada a ela.
          </p>
        </section>
      </>
    );
  }
  const [rv, ls] = await Promise.all([
    api.editorial.revisao(mp.articleId),
    api.piloto.leituras(materia),
  ]);
  if (ehErro(rv))
    return (
      <>
        {titulo}
        {voltar}
        <div className="st-alert err" role="alert">
          {mensagemErro(rv)}
          <Recarregar />
        </div>
      </>
    );
  const rev = (rv.body as { data?: Revisao }).data ?? (rv.body as Revisao);
  const leituras: Leitura[] = ehErro(ls) ? [] : ls.body.leituras;
  const ocultas = ehErro(ls) ? 0 : ls.body.ocultas;
  const l1 = leituras.find((l) => l.leitor === 1) ?? null;
  const l2 = leituras.find((l) => l.leitor === 2) ?? null;
  const d = rev.rascunho;
  return (
    <>
      {titulo}
      {voltar}
      <Flash tipo={b.tipo} aviso={b.aviso} />
      {ehErro(ls) ? (
        <div className="st-alert err" role="alert">
          Leituras indisponíveis: {mensagemErro(ls)}
          <Recarregar />
        </div>
      ) : null}
      <p className="st-hint">
        Fonte: {mp.fonte?.nome ?? "—"} · editoria {rev.editoria} · estado{" "}
        {rev.status}
        {COM_LEITOR_2.includes(materia)
          ? " · o QA 3 também lê esta matéria pela folha"
          : ""}
      </p>
      {!d ? (
        <section className="st-empty" data-estado="sem-rascunho">
          <p style={{ margin: 0 }}>Esta matéria ainda não tem rascunho.</p>
        </section>
      ) : (
        <div className="st-row" style={{ alignItems: "flex-start" }}>
          <section
            className="st-card"
            aria-labelledby="texto"
            style={{ flex: "1 1 0" }}
            data-coluna="texto"
          >
            <h2 id="texto" style={{ marginTop: 0 }}>
              {d.titulo}
            </h2>
            <div style={{ whiteSpace: "pre-wrap" }}>{d.corpo}</div>
            <p className="st-hint">{d.assinatura}</p>
            <h3>Afirmações e checagem</h3>
            <ol aria-label="Afirmações">
              {d.claims.map((c) => (
                <li
                  key={c.id}
                  data-claim={c.id}
                  data-veredito={c.verdict ?? "sem"}
                >
                  {c.text}{" "}
                  <span className="st-hint">
                    ({c.kind}; checagem:{" "}
                    {c.verdict
                      ? (ROTULO_VEREDITO[c.verdict] ?? c.verdict)
                      : "sem veredito"}
                    ; evidências: {c.evidenceIds.join(", ") || "nenhuma"})
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section
            className="st-card"
            aria-labelledby="fontes"
            style={{ flex: "1 1 0" }}
            data-coluna="fontes"
          >
            <h2 id="fontes" style={{ marginTop: 0 }}>
              Fontes
            </h2>
            {rev.evidencias.length === 0 ? (
              <p className="st-hint">Sem evidências registradas.</p>
            ) : (
              <ul aria-label="Evidências">
                {rev.evidencias.map((e) => (
                  <li key={e.id} data-evidencia={e.id}>
                    <code>{e.id}</code>{" "}
                    <a href={e.url} rel="noreferrer noopener">
                      {e.titulo || e.url}
                    </a>
                    <div className="st-hint">
                      capturada em {quando(e.capturadoEm)} UTC
                      {e.suspeita ? " · marcada como suspeita" : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <div
        className="st-row"
        style={{ alignItems: "flex-start", marginTop: 14 }}
      >
        <section
          className="st-card"
          aria-labelledby="gate"
          style={{ flex: "1 1 0" }}
          data-gate={rev.gate.passou ? "passou" : "nao-passou"}
        >
          <h3 id="gate" style={{ marginTop: 0 }}>
            Checagem automática: {rev.gate.passou ? "passou" : "não passou"}
          </h3>
          <p className="st-hint">
            Independência:{" "}
            {rev.gate.independencia.independent
              ? "redação e checagem por provedores diferentes"
              : "não comprovada"}{" "}
            ({rev.gate.independencia.draftProvider ?? "—"} /{" "}
            {rev.gate.independencia.factcheckProvider ?? "—"})
          </p>
          {rev.gate.achados.length === 0 ? (
            <p className="st-hint">Sem achados.</p>
          ) : (
            <ul aria-label="Achados da checagem">
              {rev.gate.achados.map((a, i) => (
                <li key={`${a.code}-${i}`}>
                  <code>{a.code}</code> {a.message}
                </li>
              ))}
            </ul>
          )}
          {rev.bloqueios.length ? (
            <p>Bloqueios: {rev.bloqueios.join(", ")}</p>
          ) : null}
        </section>
        <section
          className="st-card"
          aria-labelledby="tom"
          style={{ flex: "1 1 0" }}
        >
          <h3 id="tom" style={{ marginTop: 0 }}>
            Tom e revisão
          </h3>
          {rev.avisosDeTom.length === 0 ? (
            <p className="st-hint" data-vazio="tom">
              Sem avisos de tom.
            </p>
          ) : (
            <ul aria-label="Avisos de tom">
              {rev.avisosDeTom.map((a, i) => (
                <li key={`${a.code}-${i}`}>{a.message}</li>
              ))}
            </ul>
          )}
          {rev.revisoes.length === 0 ? (
            <p className="st-hint">Sem revisão humana registrada.</p>
          ) : (
            <ul aria-label="Revisões">
              {rev.revisoes.map((r, i) => (
                <li key={i}>
                  {r.decision ?? "revisão"}
                  {r.note ? `: ${r.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {ocultas > 0 && !l1 ? (
        <p
          className="st-hint"
          role="note"
          data-ocultas={ocultas}
          style={{ marginTop: 14 }}
        >
          Há {ocultas} leitura(s) de outro leitor desta matéria, oculta(s) até
          você registrar a sua (leitura cega).
        </p>
      ) : null}
      {[l1, l2]
        .filter((l): l is Leitura => !!l)
        .map((l) => (
          <section
            key={l.leitor}
            className="st-card"
            style={{ marginTop: 14 }}
            aria-label={`Leitura do leitor ${l.leitor}`}
            data-leitura={l.leitor}
          >
            <h2 style={{ marginTop: 0 }}>
              {l.leitor === 1 ? "Sua leitura" : "Leitura do QA 3"}:{" "}
              {l.veredito === "aprovado" ? "aprovada" : "bloqueada"}
            </h2>
            <p className="st-hint">
              Registrada em {quando(l.em)} UTC · {l.unsupportedFacts} fato(s)
              não suportado(s): {l.altas} alta(s), {l.medias} média(s),{" "}
              {l.baixas} baixa(s). A leitura é definitiva.
              {l.origem === 'importacao' ? (
                <span data-origem="importacao">
                  {' '}
                  · {l.por}
                  {l.arquivo ? ` (arquivo ${l.arquivo.nome}, sha256 ${l.arquivo.sha256.slice(0, 12)}…)` : ''}
                </span>
              ) : null}
            </p>
            {l.achados.length ? (
              <ul aria-label={`Achados do leitor ${l.leitor}`}>
                {l.achados.map((a, i) => (
                  <li key={i}>
                    &quot;{a.trecho}&quot; · {ROTULO_TIPO[a.tipo]} · gravidade{" "}
                    {ROTULO_GRAVIDADE[a.gravidade].toLowerCase()}
                    {a.evidenciaId ? ` · evidência ${a.evidenciaId}` : ""}
                    {a.nota ? ` · ${a.nota}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nenhum fato não suportado.</p>
            )}
          </section>
        ))}

      {l1 ? null : (
        <form
          action={registrarLeituraAction}
          className="st-card"
          style={{ marginTop: 14 }}
          aria-label="Registrar leitura"
        >
          <h2 style={{ marginTop: 0 }}>Registrar leitura</h2>
          <input type="hidden" name="materia" value={materia} />
          <p className="st-hint">
            Uma linha por fato material que NÃO bate com a evidência. Deixe em
            branco se tudo bate. A gravidade padrão vem do tipo.
          </p>
          {[0, 1, 2, 3, 4].map((i) => (
            <fieldset
              key={i}
              className="st-row"
              style={{ border: 0, padding: 0, margin: "0 0 8px" }}
            >
              <legend className="st-hint">Achado {i + 1}</legend>
              <div className="st-field" style={{ flex: "2 1 0" }}>
                <label htmlFor={`trecho${i}`}>Trecho</label>
                <input
                  id={`trecho${i}`}
                  name={`trecho${i}`}
                  type="text"
                  maxLength={500}
                />
              </div>
              <div className="st-field">
                <label htmlFor={`tipo${i}`}>Tipo</label>
                <select id={`tipo${i}`} name={`tipo${i}`} defaultValue="">
                  <option value="">—</option>
                  {TIPOS.map((t) => (
                    <option key={t} value={t}>
                      {ROTULO_TIPO[t]} (
                      {ROTULO_GRAVIDADE[GRAVIDADE_DO_TIPO[t]].toLowerCase()})
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-field">
                <label htmlFor={`gravidade${i}`}>Gravidade</label>
                <select
                  id={`gravidade${i}`}
                  name={`gravidade${i}`}
                  defaultValue=""
                >
                  <option value="">Padrão do tipo</option>
                  <option value="alta">Alta</option>
                  <option value="media">Média</option>
                  <option value="baixa">Baixa</option>
                </select>
              </div>
              <div className="st-field">
                <label htmlFor={`evidencia${i}`}>Evidência mais próxima</label>
                <select
                  id={`evidencia${i}`}
                  name={`evidencia${i}`}
                  defaultValue=""
                >
                  <option value="">—</option>
                  {rev.evidencias.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.id}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>
          ))}
          <fieldset style={{ border: 0, padding: 0 }}>
            <legend>Confira</legend>
            <label style={{ display: "block" }}>
              <input type="checkbox" name="fatosNasEvidencias" value="sim" />{" "}
              Todos os números, datas, valores, citações e atribuições estão nas
              evidências
            </label>
            <label style={{ display: "block" }}>
              <input type="checkbox" name="tom" value="sim" /> Tom do projeto e
              sem texto copiado da fonte além do permitido
            </label>
            <label style={{ display: "block" }}>
              <input type="checkbox" name="nadaInventado" value="sim" /> Nada
              inventado (apuração, entrevista, imagem de terceiro)
            </label>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, marginTop: 8 }}>
            <legend>Veredito</legend>
            <label>
              <input type="radio" name="veredito" value="aprovado" /> Aprovada
            </label>{" "}
            <label>
              <input type="radio" name="veredito" value="bloqueado" /> Bloqueada
            </label>
          </fieldset>
          <button className="st-btn" type="submit" style={{ marginTop: 8 }}>
            Registrar leitura
          </button>
        </form>
      )}
    </>
  );
}
