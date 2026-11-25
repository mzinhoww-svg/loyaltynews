import Link from 'next/link';
import { ScrollRegion } from '../../_components/ScrollRegion';
import { MockTag } from '../../_components/ui';
import { formatDate } from '../../_lib/format';
import { MOVE_KIND_LABEL } from '../../_lib/intelligence-source';
import { linkPedido } from '../../_titular/pedido';
import s from './intel.module.css';
import type { EvidenceSource, MoveEntry, MoveReading, PersonRole } from '../../_lib/types';

/** Fonte pública: nome com link (nova aba) e data de coleta. Nunca o trecho da página. */
export function SourceLink({ source, verb = 'coletada em' }: { source: EvidenceSource; verb?: string }) {
  return (
    <>
      <a href={source.url} rel="noopener noreferrer" target="_blank" style={{ textDecoration: 'underline' }}>
        {source.name}
        <span className="pt-sr"> (abre em nova aba)</span>
      </a>
      {`, ${verb} `}
      <time dateTime={source.retrievedAt}>{formatDate(source.retrievedAt)}</time>
    </>
  );
}

const day = (d: string) => formatDate(`${d}T12:00:00Z`);

/** Aviso discreto: dado corrigido a pedido do titular (DP-38). */
export function CorrectedTag() {
  return <span className="pt-meta" data-testid="corrected-tag"> · corrigido a pedido do titular</span>;
}

/**
 * Tabela de cargos (atuais ou histórico) com empresa, período, fonte e validação.
 * `correctionFor` (id da pessoa) acrescenta o link de pedido por cargo: a URL `/intelligence/pessoas/<id>?cargo=<cargo>` é a que o
 * Backend 2 usa para identificar o cargo como alvo do pedido.
 */
/**
 * Período do cargo como a fonte declara. M-04 (revisão completa 25/11): na carga, quando a fonte não traz o início, o início gravado é o
 * próprio dia da coleta — mostrar "desde <coleta>" fazia parecer que o cargo começou nesse dia. Início igual ao dia da validação/coleta
 * = início não informado; a data de coleta fica só em "Validado em". (Pedido ao Data: um campo explícito de início declarado.)
 */
export function periodoCargo(r: Pick<PersonRole, 'validFrom' | 'validTo' | 'validatedAt' | 'periodText' | 'source' | 'startDeclared'>): string {
  if (r.periodText) return r.periodText;
  // Campo da API (inicioDeclarado, contrato do Data) quando existe; senão a mesma regra deduzida pela data.
  const inicioEhColeta = r.startDeclared !== undefined ? !r.startDeclared : r.validFrom === r.validatedAt.slice(0, 10) || r.validFrom === r.source.retrievedAt.slice(0, 10);
  if (inicioEhColeta) return r.validTo ? `início não informado na fonte; até ${day(r.validTo)}` : 'início não informado na fonte';
  return r.validTo ? `${day(r.validFrom)} a ${day(r.validTo)}` : `desde ${day(r.validFrom)}`;
}

export function RolesTable({ roles, caption, testId, showPerson, correctionFor }: { roles: (PersonRole & { personName?: string; personId?: string })[]; caption: string; testId: string; showPerson?: boolean; correctionFor?: string }) {
  return (
    <>
    {/* Legenda FORA da região de rolagem (M-02): dentro dela, no celular, a frase saía cortada junto com a tabela. */}
    <p className="pt-meta" id={`legenda-${testId}`} style={{ margin: '0 0 6px' }}>{caption}</p>
    <p className={`pt-meta ${s.dicaRolagem}`} aria-hidden="true">Deslize a tabela para o lado para ver a fonte e a data.</p>
    <ScrollRegion label={showPerson ? 'Pessoas, cargos e fontes' : 'Cargos, organizações e fontes'}>
      <table className="pt-table" data-testid={testId} aria-describedby={`legenda-${testId}`}>
        <thead>
          <tr>
            {showPerson && <th scope="col">Pessoa</th>}
            <th scope="col">Cargo</th>
            {!showPerson && <th scope="col">Organização</th>}
            <th scope="col">Período</th>
            <th scope="col">Fonte</th>
            <th scope="col">Validado em</th>
            {correctionFor && <th scope="col">Correção</th>}
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={`${r.id}-${r.personId ?? ''}`}>
              {showPerson && (
                <td>{r.mock && <MockTag />}<Link href={`/intelligence/pessoas/${r.personId}`} style={{ textDecoration: 'underline' }}>{r.personName}</Link></td>
              )}
              <td>{!showPerson && r.mock && <MockTag />}{r.title}{r.correctedByHolder && <CorrectedTag />}</td>
              {!showPerson && (
                <td><Link href={`/intelligence/empresas/${r.company.id}`} style={{ textDecoration: 'underline' }}>{r.company.name}</Link></td>
              )}
              <td data-testid="periodo">{periodoCargo(r)}</td>
              <td>
                <a href={r.source.url} rel="noopener noreferrer" target="_blank" style={{ textDecoration: 'underline' }}>{r.source.name}</a>
                <span className="pt-sr"> (abre em nova aba)</span>
              </td>
              <td><time dateTime={r.validatedAt}>{formatDate(r.validatedAt)}</time></td>
              {correctionFor && (
                <td>
                  <Link href={linkPedido(`/intelligence/pessoas/${correctionFor}?cargo=${r.id}`)} style={{ textDecoration: 'underline' }} data-testid="role-correction">
                    Pedir correção<span className="pt-sr"> do cargo {r.title}</span>
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
    </>
  );
}

function Reading({ label, r, testId }: { label: string; r: MoveReading | null; testId: string }) {
  return (
    <div data-testid={testId} style={{ flex: '1 1 240px' }}>
      <p className="pt-kicker">{label}</p>
      {r ? (
        <>
          <p style={{ margin: '4px 0' }}>
            <strong>{r.title}</strong>{' — '}
            <Link href={`/intelligence/empresas/${r.company.id}`} style={{ textDecoration: 'underline' }}>{r.company.name}</Link>
          </p>
          <p className="pt-meta">Fonte: <SourceLink source={r.source} /> · validado em <time dateTime={r.validatedAt}>{formatDate(r.validatedAt)}</time></p>
        </>
      ) : (
        <p className="pt-meta">{label === 'Antes' ? 'Sem cargo anterior registrado.' : 'Sem cargo novo: saída.'}</p>
      )}
    </div>
  );
}

/** Move confirmado: tipo, pessoa, data da leitura e as duas leituras (antes e depois) com a fonte de cada lado. */
export function MoveCard({ m, headingLevel = 2, link = true }: { m: MoveEntry; headingLevel?: 2 | 3; link?: boolean }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="pt-panel" data-testid="move-card">
      <p className="pt-kicker">{m.mock && <MockTag />}{MOVE_KIND_LABEL[m.kind]}{m.basis === 'announcement' ? ' · anunciada pela fonte' : ''}</p>
      <H style={{ fontSize: 20, margin: '4px 0' }}>
        {link ? <Link href={`/moves/${m.id}`}>{m.person.name}</Link> : m.person.name}
      </H>
      <p className="pt-meta">
        Observado em <time dateTime={m.observedOn}>{day(m.observedOn)}</time>
        {m.effectiveDate ? <> · vigente desde <time dateTime={m.effectiveDate}>{day(m.effectiveDate)}</time></> : ' · data efetiva não declarada pela fonte'}
        {' · '}<Link href={`/intelligence/pessoas/${m.person.id}`} className={s.touch} style={{ textDecoration: 'underline' }}>perfil</Link>
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 8 }}>
        <Reading label="Antes" r={m.before} testId="move-before" />
        <Reading label="Depois" r={m.after} testId="move-after" />
      </div>
    </article>
  );
}

export const MOVES_EMPTY = 'O Loyalty Moves detecta candidatos, confirma com fonte primária e só então publica. Nada é publicado como fato antes da confirmação.';
export const PEOPLE_EMPTY = 'Perfis de pessoas só são publicados com identidade e vínculo verificáveis por fonte pública. Titulares podem solicitar correção ou remoção.';
