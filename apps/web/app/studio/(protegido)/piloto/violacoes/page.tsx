import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { ACOES, ROTULO_ACAO, ROTULO_VIOLACAO, violacoesDa, type LinhaComTratamento } from '@/lib/studio/piloto-violacoes';
import { requireStudio } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { resolverViolacaoAction } from './actions';

export const metadata: Metadata = { title: 'Violações do piloto' };
export const dynamic = 'force-dynamic';

const quando = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export default async function ViolacoesPilotoPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  await requireStudio(['admin']); // resolver violação é só do admin (PM-2026-11-23-D)
  const b = await searchParams;
  const r = await api.piloto.linhas();
  return (
    <>
      <h1>Violações do piloto</h1>
      <p>
        <Link href="/studio/piloto">← Voltar ao piloto</Link>
      </p>
      <p>
        Uma violação (tentativa de publicar, chamada à API tarifada, segredo em log ou ferramenta fora do contrato) para o piloto na hora. Resolver registra o que foi
        feito, com motivo, autor e data, e libera a retomada. <strong>Nada é apagado</strong>: a linha continua na planilha e a violação continua contando no critério de
        0 violações.
      </p>
      <Flash tipo={b.tipo} aviso={b.aviso} />
      {naoConfigurado(r) ? (
        <SemBanco modulo="O piloto" />
      ) : ehErro(r) ? (
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      ) : (
        <Lista linhas={r.body.items} />
      )}
    </>
  );
}

function Lista({ linhas }: { linhas: LinhaComTratamento[] }) {
  const comViolacao = linhas.filter((l) => violacoesDa(l).length > 0);
  if (comViolacao.length === 0) {
    return (
      <section className="st-empty" aria-labelledby="sem-violacao" data-vazio="violacoes">
        <h2 id="sem-violacao">Nenhuma violação</h2>
        <p>Nenhuma linha do piloto tem parada imediata{linhas.length === 0 ? ' (o piloto ainda não gerou linhas)' : ''}.</p>
      </section>
    );
  }
  const pendentes = comViolacao.filter((l) => !l.tratada).length;
  return (
    <>
      <p data-pendentes={pendentes}>
        {comViolacao.length} linha(s) com violação; {pendentes} sem resolução. A retomada do piloto só considera as que ainda não foram resolvidas.
      </p>
      <ul className="st-issues" aria-label="Linhas com violação">
        {comViolacao.map((l) => {
          const v = violacoesDa(l);
          const id = `${l.task_id}-${l.attempt}`;
          return (
            <li key={id} data-linha={id} data-estado={l.tratada ? 'resolvida' : 'pendente'}>
              <p style={{ margin: '4px 0' }}>
                <strong>{l.task_id}</strong> · tentativa {l.attempt} · {String(l.stage ?? '—')} · {String(l.account ?? '—')}
              </p>
              <p style={{ margin: 0 }}>{v.map((x) => ROTULO_VIOLACAO[x]).join(' · ')}</p>
              {l.tratada ? (
                <p className="st-hint" data-tratada>
                  Resolvida por {l.tratada.por} em {quando(l.tratada.em)} UTC · ação: {l.tratada.acao} · motivo: {l.tratada.motivo}
                </p>
              ) : (
                <form action={resolverViolacaoAction} className="st-card" style={{ marginTop: 8 }} aria-label={`Resolver ${id}`}>
                  <input type="hidden" name="taskId" value={l.task_id} />
                  <input type="hidden" name="attempt" value={l.attempt} />
                  <div className="st-row">
                    <div className="st-field">
                      <label htmlFor={`acao-${id}`}>Ação tomada</label>
                      <select id={`acao-${id}`} name="acao" defaultValue={v.includes('secret_in_log') ? 'segredo_rotacionado' : ''} required>
                        <option value="">—</option>
                        {ACOES.map((a) => (
                          <option key={a} value={a}>
                            {ROTULO_ACAO[a]}
                          </option>
                        ))}
                        <option value="outra">Outra (descrever)</option>
                      </select>
                    </div>
                    <div className="st-field">
                      <label htmlFor={`outra-${id}`}>Outra ação</label>
                      <input id={`outra-${id}`} name="acaoOutra" type="text" maxLength={200} />
                    </div>
                  </div>
                  {v.includes('secret_in_log') ? <p className="st-hint">Segredo em log só se resolve com o segredo rotacionado.</p> : null}
                  <div className="st-field">
                    <label htmlFor={`motivo-${id}`}>Motivo (10 a 500 caracteres)</label>
                    <textarea id={`motivo-${id}`} name="motivo" rows={2} minLength={10} maxLength={500} required />
                  </div>
                  <div className="st-field">
                    <label>
                      <input type="checkbox" name="confirmo" value="sim" /> Confirmo: a resolução é definitiva e fica na trilha de auditoria
                    </label>
                  </div>
                  <button className="st-btn danger" type="submit">
                    Resolver violação
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
