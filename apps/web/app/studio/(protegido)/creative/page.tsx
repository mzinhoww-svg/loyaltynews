import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@ln/auth';
import { isEnabled } from '@ln/contracts';
import { findModule } from '@/lib/studio/modules';
import { api, type CardPedido, type CardSocial } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { criarCardAction, transicaoCardAction } from './actions';

export const metadata: Metadata = { title: 'Creative studio' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 20;
const ESTADOS: CardSocial['estado'][] = ['rascunho', 'em_revisao', 'aprovado', 'rejeitado'];
const ROTULO_ESTADO: Record<CardSocial['estado'], string> = { rascunho: 'rascunho', em_revisao: 'em revisão', aprovado: 'aprovado', rejeitado: 'rejeitado' };
const FORMATOS: Record<CardPedido['format'], string> = { linkedin_landscape: 'LinkedIn paisagem (1200×627)', square: 'Quadrado (1080×1080)' };
const KINDS: Record<CardPedido['kind'], string> = { materia: 'Matéria', analise: 'Análise autoral' };

type Busca = { tipo?: string; aviso?: string; artigo?: string; kind?: string; formato?: string; autoral?: string; estado?: string; pagina?: string };

/** Transições oferecidas por estado, conforme o contrato (o Backend confere papel e "quem criou não aprova"). */
function acoes(card: CardSocial, podeCriar: boolean, podePublicar: boolean): { para: CardSocial['estado']; rotulo: string; motivo?: boolean }[] {
  if (card.estado === 'rascunho') return podeCriar ? [{ para: 'em_revisao', rotulo: 'Enviar para revisão' }] : [];
  if (card.estado === 'em_revisao')
    return [
      ...(podePublicar ? [{ para: 'aprovado' as const, rotulo: 'Aprovar' }, { para: 'rejeitado' as const, rotulo: 'Rejeitar', motivo: true }] : []),
      ...(podeCriar ? [{ para: 'rascunho' as const, rotulo: 'Voltar a rascunho' }] : []),
    ];
  if (card.estado === 'rejeitado') return podeCriar ? [{ para: 'rascunho', rotulo: 'Voltar a rascunho' }] : [];
  return [];
}

export default async function CreativePage({ searchParams }: { searchParams: Promise<Busca> }) {
  const { session } = await requireModule(findModule('creative')!);
  const sp = await searchParams;
  const papeis = session.roles;
  const podeCriar = papeis.some((r) => can(r, 'social', 'create'));
  const podePublicar = papeis.some((r) => can(r, 'social', 'publish'));

  const estado = ESTADOS.includes(sp.estado as CardSocial['estado']) ? sp.estado : '';
  const pag = Math.max(1, Number.parseInt(sp.pagina ?? '1', 10) || 1);
  const lista = await api.creative.cards({ ...(estado ? { estado } : {}), limit: String(POR_PAGINA), offset: String((pag - 1) * POR_PAGINA) });
  if (naoConfigurado(lista)) {
    return (
      <>
        <h1>Creative studio</h1>
        <SemBanco modulo="O Creative studio" />
      </>
    );
  }
  // matérias para gerar o card (a lista do CMS; o Backend recusa o que o template não aceita)
  const materias = await api.materias.listar({});
  const opcoes = ehErro(materias) ? [] : materias.body.data;

  // prévia: só quando a pessoa pede (não grava nada)
  const pedido: CardPedido | null =
    sp.artigo && (sp.kind === 'materia' || sp.kind === 'analise') && (sp.formato === 'linkedin_landscape' || sp.formato === 'square')
      ? { articleId: sp.artigo, kind: sp.kind, format: sp.formato, ...(sp.autoral ? { autoralFormato: sp.autoral as CardPedido['autoralFormato'] } : {}) }
      : null;
  const previa = pedido ? await api.creative.previa(pedido) : null;

  const total = ehErro(lista) ? 0 : lista.body.total;
  const cards = ehErro(lista) ? [] : lista.body.data;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const link = (n: number) => '?' + new URLSearchParams({ ...(estado ? { estado } : {}), pagina: String(n) }).toString();

  return (
    <>
      <h1>Creative studio</h1>
      <p>
        Cards sociais gerados por template a partir de uma matéria, com prévia, revisão e download do PNG. <strong>Nada é publicado nem agendado</strong>: “aprovado” só deixa o card
        pronto para o pacote de distribuição. Imagens e direitos ficam na <Link href="/studio/midia">Biblioteca de mídia</Link>.
      </p>
      <p className="st-hint" data-testid="distribuicao">
        Distribuição no Instagram: <strong>{isEnabled('instagram') ? 'ligada' : 'desligada'}</strong> (flag instagram).
      </p>
      <Flash tipo={sp.tipo} aviso={sp.aviso} />

      <section className="st-card" aria-labelledby="h-gerar">
        <h2 id="h-gerar" style={{ marginTop: 0 }}>
          Gerar card
        </h2>
        {opcoes.length === 0 ? (
          <p data-vazio="materias">{ehErro(materias) ? `Não foi possível listar as matérias: ${mensagemErro(materias)}` : 'Nenhuma matéria no CMS para gerar card.'}</p>
        ) : (
          <form method="get" aria-label="Prévia do card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <div className="st-field">
                <label htmlFor="artigo">Matéria</label>
                <select id="artigo" name="artigo" defaultValue={sp.artigo ?? ''}>
                  {opcoes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.titulo} ({m.tipoConteudo}, {m.status})
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-field">
                <label htmlFor="kind">Template</label>
                <select id="kind" name="kind" defaultValue={sp.kind ?? 'materia'}>
                  {Object.entries(KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-field">
                <label htmlFor="formato">Formato</label>
                <select id="formato" name="formato" defaultValue={sp.formato ?? 'linkedin_landscape'}>
                  {Object.entries(FORMATOS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-field">
                <label htmlFor="autoral">Formato autoral (só análise)</label>
                <select id="autoral" name="autoral" defaultValue={sp.autoral ?? ''}>
                  <option value="">Padrão</option>
                  <option value="analise">Análise</option>
                  <option value="explicador">Explicador</option>
                  <option value="comparativo">Comparativo</option>
                </select>
              </div>
            </div>
            <div className="st-actions" style={{ marginTop: 8 }}>
              <button className="st-btn sec" type="submit">
                Ver prévia
              </button>
            </div>
          </form>
        )}

        {previa && pedido ? (
          ehErro(previa) ? (
            <div className="st-alert err" role="alert" data-testid="previa-recusa">
              Prévia recusada: {mensagemErro(previa)}
            </div>
          ) : (
            <div data-testid="previa" style={{ marginTop: 12 }}>
              <h3>Prévia</h3>
              {previa.body.mock ? <p className="st-alert err">MOCK — conteúdo de exemplo, não publicar.</p> : null}
              {/* SVG do próprio Backend (sem <text>, sem script); como imagem data: ele não executa nada */}
              <img
                src={`data:image/svg+xml;base64,${Buffer.from(previa.body.svg, 'utf8').toString('base64')}`}
                alt={previa.body.altText}
                width={previa.body.width}
                height={previa.body.height}
                style={{ maxWidth: '100%', height: 'auto', border: '1px solid var(--st-line)' }}
              />
              <p className="st-hint">
                {previa.body.width}×{previa.body.height} · SVG sha256 {previa.body.svgSha256.slice(0, 12)}… · marca: {previa.body.brandStatus}
              </p>
              {podeCriar ? (
                <form action={criarCardAction}>
                  <input type="hidden" name="artigo" value={pedido.articleId} />
                  <input type="hidden" name="kind" value={pedido.kind} />
                  <input type="hidden" name="formato" value={pedido.format} />
                  <input type="hidden" name="autoral" value={pedido.autoralFormato ?? ''} />
                  <button className="st-btn" type="submit">
                    Salvar card em rascunho
                  </button>
                </form>
              ) : (
                <p className="st-hint">Seu papel só acompanha os cards (não cria).</p>
              )}
            </div>
          )
        ) : null}
      </section>

      <section aria-labelledby="h-cards" style={{ marginTop: 18 }}>
        <h2 id="h-cards">Cards</h2>
        <form className="st-filters" method="get" role="search" aria-label="Filtrar cards">
          <div className="st-field">
            <label htmlFor="f-estado">Estado</label>
            <select id="f-estado" name="estado" defaultValue={estado}>
              <option value="">Todos</option>
              {ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {ROTULO_ESTADO[e]}
                </option>
              ))}
            </select>
          </div>
          <button className="st-btn sec" type="submit">
            Filtrar
          </button>
        </form>
        {ehErro(lista) ? (
          <div className="st-alert err" role="alert">
            Não foi possível carregar os cards: {mensagemErro(lista)}
          </div>
        ) : cards.length === 0 ? (
          <section className="st-empty" aria-labelledby="vazio-cards" data-vazio={estado ? 'filtro' : 'cards'}>
            <h3 id="vazio-cards">Nenhum card</h3>
            <p>{estado ? 'Nenhum card neste estado.' : 'Nenhum card salvo ainda. Gere a prévia de uma matéria e salve o card.'}</p>
          </section>
        ) : (
          <>
            <table className="st-table" aria-label="Cards sociais">
              <thead>
                <tr>
                  <th scope="col">Matéria</th>
                  <th scope="col">Template e formato</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.id} data-card={c.id} data-estado={c.estado}>
                    <td>
                      {c.articleTitulo ?? c.articleId}
                      <div className="st-hint">
                        Criado por {c.criadoPor} em {c.criadoEm.slice(0, 16).replace('T', ' ')}
                        {c.revisadoPor ? ` · revisado por ${c.revisadoPor}` : ''}
                        {c.motivo ? ` · motivo: ${c.motivo}` : ''}
                        {c.mock ? ' · MOCK' : ''}
                      </div>
                    </td>
                    <td>
                      {KINDS[c.kind]}
                      {c.autoralFormato ? ` (${c.autoralFormato})` : ''} · {FORMATOS[c.format]}
                    </td>
                    <td>
                      <span className="st-badge">{ROTULO_ESTADO[c.estado]}</span>
                    </td>
                    <td>
                      <div className="st-actions">
                        <a className="st-btn sec" href={`/api/studio/creative/cards/${encodeURIComponent(c.id)}/png`} download aria-label={`Baixar PNG ${c.id}`}>
                          Baixar PNG
                        </a>
                        {acoes(c, podeCriar, podePublicar).map((a) => (
                          <form action={transicaoCardAction} key={a.para}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="para" value={a.para} />
                            {a.motivo ? (
                              <label>
                                Motivo <input type="text" name="motivo" maxLength={500} aria-label={`Motivo para rejeitar ${c.id}`} />
                              </label>
                            ) : null}{' '}
                            <button className={a.para === 'rejeitado' ? 'st-btn danger' : 'st-btn sec'} type="submit" aria-label={`${a.rotulo} ${c.id}`}>
                              {a.rotulo}
                            </button>
                          </form>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="st-hint">
              {total} card(s) · página {pag} de {paginas} {pag > 1 ? <Link href={link(pag - 1)}>Anterior</Link> : null}{' '}
              {pag < paginas ? <Link href={link(pag + 1)}>Próxima</Link> : null}
            </p>
          </>
        )}
      </section>
    </>
  );
}
