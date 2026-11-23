import type { Metadata } from 'next';
import Link from 'next/link';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { habilitarFonteFabricaAction, revisarFonteFabricaAction } from './actions';

export const metadata: Metadata = { title: 'Fontes da Fábrica editorial' };
export const dynamic = 'force-dynamic';

interface FonteFabrica {
  id: string;
  /** 'padrao' | 'via-provedor' (DP-31/DP-32: lida por serviço de extração, risco aceito pelo proprietário) */
  acesso?: string;
  nome: string;
  kind: string;
  host: string;
  editorias: string[];
  termsUrl: string | null;
  pesquisa: { nivel: string | null; pesquisadoPor: string | null; trechoTermos: string | null };
  habilitada: boolean;
  termsStatus: string;
  urlVerificada: boolean;
  paywall: string;
  elegivel: boolean;
  motivosInelegivel: string[];
  revisao: { revisor: string; em: string; termos: string; vencida: boolean } | null;
}

export default async function FontesFabricaPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string; q?: string }> }) {
  const { session } = await requireModule(findModule('fontes')!);
  const { tipo, aviso, q = '' } = await searchParams;
  const r = await api.editorial.fontesRegistro();
  if (naoConfigurado(r)) {
    return (
      <>
        <h1>Fontes da Fábrica editorial</h1>
        <SemBanco modulo="O registro de fontes da Fábrica" />
      </>
    );
  }
  if (ehErro(r)) {
    return (
      <>
        <h1>Fontes da Fábrica editorial</h1>
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      </>
    );
  }
  const todas = (r.body as { items: FonteFabrica[] }).items;
  const termo = q.trim().toLowerCase();
  const itens = termo ? todas.filter((f) => f.nome.toLowerCase().includes(termo) || f.host.toLowerCase().includes(termo)) : todas;
  const podeRevisar = checkAccess(session, ['admin', 'editor_chefe', 'revisor']).ok;
  const podeHabilitar = checkAccess(session, ['admin', 'editor_chefe']).ok;
  return (
    <>
      <p>
        <Link href="/studio/fontes">← Banco de fontes</Link>
      </p>
      <h1>Fontes da Fábrica editorial</h1>
      <p>
        Cadastro imutável de fontes que a coleta pode usar. Habilitar nunca é automático: exige revisão humana atual dos termos (revisor diferente de quem pesquisou), URL verificada, robots.txt conferido e sem paywall. A coleta segue desligada pela flag editorialCollector.
      </p>
      <Flash tipo={tipo} aviso={aviso} />
      <form className="st-filters" method="get" role="search" aria-label="Buscar fonte da Fábrica">
        <div className="st-field">
          <label htmlFor="q">Buscar por nome ou host</label>
          <input id="q" name="q" type="search" defaultValue={q} />
        </div>
        <button className="st-btn sec" type="submit">
          Buscar
        </button>
      </form>
      {itens.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhuma fonte encontrada</h2>
          <p>O cadastro da Fábrica não tem fontes para esta busca.</p>
        </section>
      ) : (
        <>
          <p className="st-hint">
            {itens.length} fonte(s); {itens.filter((f) => f.habilitada).length} habilitada(s).
          </p>
          {itens.map((f) => (
            <section key={f.id} className="st-card" style={{ marginBottom: 12 }} aria-label={f.nome} data-fabrica-fonte={f.id} data-habilitada={f.habilitada ? 'sim' : 'nao'}>
              <h2 style={{ marginTop: 0 }}>{f.nome}</h2>
              {f.acesso === 'via-provedor' ? (
                <p className="st-alert" role="note" data-acesso="via-provedor">
                  <strong>Acesso via provedor</strong> (risco aceito, DP-31/DP-32): a página é lida por um serviço de extração, não pela coleta direta.
                </p>
              ) : null}
              <p className="st-hint">
                {f.host} · {f.kind} · {f.editorias.join(', ')} · pesquisada por {f.pesquisa.pesquisadoPor ?? 'desconhecido'}
              </p>
              <p>
                Estado: <strong>{f.habilitada ? 'habilitada' : 'desabilitada'}</strong> · termos {f.termsStatus} · URL {f.urlVerificada ? 'verificada' : 'não verificada'} · paywall {f.paywall} · {f.elegivel ? 'elegível' : `inelegível (${f.motivosInelegivel.join('; ')})`}
              </p>
              {f.revisao ? (
                <p className="st-hint">
                  Última revisão: {f.revisao.revisor} em {f.revisao.em.slice(0, 16).replace('T', ' ')} ({f.revisao.termos}){f.revisao.vencida ? ' — VENCIDA: a definição da fonte mudou' : ''}.
                </p>
              ) : (
                <p className="st-hint">Sem revisão registrada.</p>
              )}
              <div className="st-actions">
                {podeHabilitar && !f.habilitada ? (
                  <form action={habilitarFonteFabricaAction}>
                    <input type="hidden" name="sourceId" value={f.id} />
                    <input type="hidden" name="ligar" value="1" />
                    <button className="st-btn" type="submit" aria-label={`Habilitar ${f.nome}`}>
                      Habilitar
                    </button>
                  </form>
                ) : null}
                {podeRevisar && f.habilitada ? (
                  <form action={habilitarFonteFabricaAction}>
                    <input type="hidden" name="sourceId" value={f.id} />
                    <input type="hidden" name="ligar" value="0" />
                    <button className="st-btn danger" type="submit" aria-label={`Desabilitar ${f.nome}`}>
                      Desabilitar
                    </button>
                  </form>
                ) : null}
              </div>
              {podeRevisar ? (
                <details style={{ marginTop: 10 }}>
                  <summary>Registrar revisão dos termos</summary>
                  <form action={revisarFonteFabricaAction} aria-label={`Revisar ${f.nome}`}>
                    <input type="hidden" name="sourceId" value={f.id} />
                    <div className="st-field">
                      <label htmlFor={`termos-${f.id}`}>Termos</label>
                      <select id={`termos-${f.id}`} name="termos" defaultValue="approved">
                        <option value="approved">Aprovados</option>
                        <option value="denied">Negados</option>
                      </select>
                    </div>
                    <div className="st-field">
                      <label htmlFor={`nota-${f.id}`}>O que foi conferido nos termos oficiais (mínimo 20 caracteres)</label>
                      <input id={`nota-${f.id}`} name="nota" type="text" />
                    </div>
                    <div className="st-field">
                      <label>
                        <input type="checkbox" name="urlVerificada" /> URL verificada
                      </label>
                      <label>
                        <input type="checkbox" name="robots" /> robots.txt conferido
                      </label>
                    </div>
                    <div className="st-field">
                      <label htmlFor={`paywall-${f.id}`}>Paywall / login</label>
                      <select id={`paywall-${f.id}`} name="paywall" defaultValue="none">
                        <option value="none">Nenhum</option>
                        <option value="login">Exige login</option>
                        <option value="metered">Limite de leituras</option>
                      </select>
                    </div>
                    <button className="st-btn" type="submit">
                      Registrar revisão
                    </button>
                  </form>
                </details>
              ) : null}
            </section>
          ))}
        </>
      )}
    </>
  );
}
