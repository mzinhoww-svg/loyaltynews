import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/studio/rotas-api";
import { ehErro, mensagemErro, naoConfigurado } from "@/lib/studio/backend";
import { findModule } from "@/lib/studio/modules";
import { CABECALHO } from "@/lib/studio/piloto-importacao";
import { COM_LEITOR_2 } from "@/lib/studio/piloto-view";
import { requireModule } from "../../../_lib/guard";
import { Flash } from "../../../_components/Flash";
import { SemBanco } from "../../../_components/SemBanco";
import { importarFolhaAction } from "./actions";
import { QuadroRolavel } from "../../../_components/QuadroRolavel";

export const metadata: Metadata = { title: "Importar a leitura do leitor 2" };
export const dynamic = "force-dynamic";

export default async function ImportarFolhaPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; aviso?: string }>;
}) {
  await requireModule(findModule("piloto")!);
  const b = await searchParams;
  const r = await api.piloto.materias();
  return (
    <>
      <h1>Importar a leitura do leitor 2</h1>
      <p>
        <Link href="/studio/piloto">← Voltar às 10 matérias</Link>
      </p>
      <p>
        O QA 3 lê as matérias a1, a4, a6 e a9 pela folha do piloto, fora do
        Studio. Aqui você carrega o arquivo dele: cada linha é conferida com as
        regras da leitura, as inválidas são recusadas com o motivo, e as
        leituras entram como do leitor 2, com &quot;importado por você da folha
        de …&quot;, o hash do arquivo e a data.
      </p>
      <div className="st-alert" role="note" data-aviso="cegueira">
        Leitura cega: a prévia nunca mostra o conteúdo da folha, só quais
        matérias e quantas linhas. Uma matéria só é importada depois que você
        registrou a sua leitura dela. O hash do arquivo fica registrado já no
        primeiro envio, para provar que a folha não mudou depois.
      </div>
      <Flash tipo={b.tipo} aviso={b.aviso} />
      {naoConfigurado(r) ? (
        <SemBanco modulo="A leitura do piloto" />
      ) : ehErro(r) ? (
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      ) : (
        <>
          <QuadroRolavel rotulo="Matérias com leitor 2">
            <table className="st-table" style={{ marginTop: 14 }}>
              <thead>
                <tr>
                  <th scope="col">Matéria</th>
                  <th scope="col">Sua leitura</th>
                  <th scope="col">Folha registrada</th>
                  <th scope="col">Leitor 2</th>
                </tr>
              </thead>
              <tbody>
                {r.body.items
                  .filter((m) => COM_LEITOR_2.includes(m.materia))
                  .map((m) => (
                    <tr key={m.materia} data-materia={m.materia}>
                      <td>{m.materia}</td>
                      <td>
                        {!m.articleId ? (
                          <span className="st-hint">matéria não gerada</span>
                        ) : m.leituras.leitor1 ? (
                          "registrada"
                        ) : (
                          "falta registrar (a importação espera)"
                        )}
                      </td>
                      <td data-folha={m.folha?.sha256 ?? ""}>
                        {m.folha ? (
                          `sha256 ${m.folha.sha256.slice(0, 12)}… em ${m.folha.em.slice(0, 16).replace("T", " ")} UTC`
                        ) : (
                          <span className="st-hint">nenhuma</span>
                        )}
                      </td>
                      <td>
                        {m.leituras.leitor2 ? (
                          "importada"
                        ) : (
                          <span className="st-hint">não importada</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </QuadroRolavel>
          <form
            action={importarFolhaAction}
            className="st-card"
            style={{ marginTop: 14 }}
            aria-label="Importar folha do leitor 2"
          >
            <div className="st-field">
              <label htmlFor="arquivo">Arquivo CSV da folha (UTF-8)</label>
              <input
                id="arquivo"
                name="arquivo"
                type="file"
                accept=".csv,text/csv"
                required
              />
              <p className="st-hint" style={{ margin: "4px 0 0" }}>
                Modelo, uma linha por achado (matéria sem achado = uma linha com
                os campos de achado vazios): <code>{CABECALHO.join(",")}</code>
              </p>
            </div>
            <div className="st-field">
              <label htmlFor="leitor2Nome">Quem leu</label>
              <input
                id="leitor2Nome"
                name="leitor2Nome"
                type="text"
                defaultValue="QA 3"
                minLength={2}
                maxLength={80}
                required
              />
            </div>
            <div className="st-field">
              <label>
                <input type="checkbox" name="confirmo" value="sim" /> Confirmo a
                importação: as leituras ficam definitivas
              </label>
            </div>
            <div className="st-actions">
              <button
                className="st-btn sec"
                type="submit"
                name="passo"
                value="validar"
              >
                Validar e registrar a folha
              </button>
              <button
                className="st-btn"
                type="submit"
                name="passo"
                value="importar"
              >
                Importar
              </button>
            </div>
          </form>
        </>
      )}
    </>
  );
}
