// Importação da folha do leitor 2 (QA 3) no piloto (Studio 2; PM-2026-11-23-C). Funções puras: parse do CSV, validação linha a linha contra o
// contrato da Editorial (piloto-leitura-api.md) e montagem das leituras por matéria. A rota POST /piloto/importacao é da Editorial.
// Formato (UTF-8, uma linha por achado; matéria sem achado = uma linha com os campos de achado vazios):
//   materia,trecho,tipo,gravidade,evidencia_id,nota,fatos_nas_evidencias,tom,nada_inventado,veredito
import { COM_LEITOR_2, TIPOS, type Achado, type Checklist, type Gravidade, type MateriaId, type TipoAchado } from './piloto-view';

export const CABECALHO = ['materia', 'trecho', 'tipo', 'gravidade', 'evidencia_id', 'nota', 'fatos_nas_evidencias', 'tom', 'nada_inventado', 'veredito'] as const;
export const MAX_BYTES = 200_000;
export const MAX_LINHAS = 500;

/** Parse de CSV (RFC 4180: aspas, aspas duplicadas, vírgula e quebra de linha dentro de aspas; aceita ; como separador e BOM). */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^\uFEFF/, '');
  const primeira = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
      continue;
    }
    if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo);
      if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
  return linhas;
}

const SIM = new Set(['sim', 's', 'true', '1', 'x', 'yes']);
const NAO = new Set(['nao', 'não', 'n', 'false', '0', '']);
const bool = (v: string): boolean | null => (SIM.has(v.trim().toLowerCase()) ? true : NAO.has(v.trim().toLowerCase()) ? false : null);

export interface LinhaValidada {
  numero: number;
  materia: string;
  ok: boolean;
  motivo: string | null;
}
export interface LeituraImportada {
  materia: MateriaId;
  achados: Achado[];
  checklist: Checklist;
  veredito: 'aprovado' | 'bloqueado';
}
export type ResultadoImportacao =
  | { ok: false; erro: string }
  | { ok: true; linhas: LinhaValidada[]; leituras: LeituraImportada[]; invalidas: number };

/**
 * Valida o CSV inteiro: cabeçalho exato, cada linha nas regras do contrato e coerência por matéria (checklist e veredito iguais em todas as
 * linhas da matéria; "aprovado" sem alta e com checklist completo). Linha inválida vem com o motivo; matéria com linha inválida não é importada.
 */
export function validarFolha(texto: string): ResultadoImportacao {
  if (new TextEncoder().encode(texto).length > MAX_BYTES) return { ok: false, erro: `Arquivo maior que ${MAX_BYTES / 1000} KB.` };
  const rows = lerCsv(texto);
  if (rows.length < 2) return { ok: false, erro: 'Arquivo vazio: esperado o cabeçalho e ao menos uma linha.' };
  const cab = rows[0]!.map((c) => c.trim().toLowerCase());
  if (cab.join(',') !== CABECALHO.join(',')) return { ok: false, erro: `Cabeçalho diferente do modelo. Esperado: ${CABECALHO.join(',')}` };
  if (rows.length - 1 > MAX_LINHAS) return { ok: false, erro: `No máximo ${MAX_LINHAS} linhas.` };

  const linhas: LinhaValidada[] = [];
  const porMateria = new Map<MateriaId, { achados: Achado[]; checklist: Checklist; veredito: 'aprovado' | 'bloqueado'; numeros: number[]; ruim: boolean }>();
  for (const [i, r] of rows.slice(1).entries()) {
    const numero = i + 2;
    const v = Object.fromEntries(CABECALHO.map((k, j) => [k, (r[j] ?? '').trim()])) as Record<(typeof CABECALHO)[number], string>;
    const falha = (motivo: string) => linhas.push({ numero, materia: v.materia, ok: false, motivo });
    if (r.length !== CABECALHO.length) { falha(`esperadas ${CABECALHO.length} colunas, vieram ${r.length}`); continue; }
    const materia = v.materia.toLowerCase();
    if (!(COM_LEITOR_2 as readonly string[]).includes(materia)) { falha('o leitor 2 só lê a1, a4, a6 e a9'); continue; }
    const m = materia as MateriaId;
    const checklist = { fatosNasEvidencias: bool(v.fatos_nas_evidencias), tom: bool(v.tom), nadaInventado: bool(v.nada_inventado) };
    if (Object.values(checklist).some((x) => x === null)) { falha('checklist: use sim ou não nas três colunas'); marcar(m); continue; }
    const veredito = v.veredito.toLowerCase();
    if (veredito !== 'aprovado' && veredito !== 'bloqueado') { falha('veredito: aprovado ou bloqueado'); marcar(m); continue; }
    let achado: Achado | null = null;
    const temAchado = !!(v.trecho || v.tipo || v.gravidade || v.evidencia_id || v.nota);
    if (temAchado) {
      if (v.trecho.length < 3 || v.trecho.length > 500) { falha('trecho de 3 a 500 caracteres'); marcar(m); continue; }
      if (!(TIPOS as readonly string[]).includes(v.tipo)) { falha(`tipo inválido: use ${TIPOS.join(', ')}`); marcar(m); continue; }
      const g = v.gravidade.toLowerCase().replace('média', 'media');
      if (g !== 'alta' && g !== 'media' && g !== 'baixa') { falha('gravidade: alta, media ou baixa'); marcar(m); continue; }
      if (v.evidencia_id.length > 128 || v.nota.length > 500) { falha('evidência até 128 e nota até 500 caracteres'); marcar(m); continue; }
      achado = { trecho: v.trecho, tipo: v.tipo as TipoAchado, gravidade: g as Gravidade, ...(v.evidencia_id ? { evidenciaId: v.evidencia_id } : {}), ...(v.nota ? { nota: v.nota } : {}) };
    }
    const atual = porMateria.get(m);
    const ck = checklist as Checklist;
    if (atual && (atual.veredito !== veredito || JSON.stringify(atual.checklist) !== JSON.stringify(ck))) {
      falha('checklist e veredito têm de ser iguais em todas as linhas da matéria');
      atual.ruim = true;
      continue;
    }
    const alvo = atual ?? { achados: [], checklist: ck, veredito, numeros: [], ruim: false };
    if (achado) alvo.achados.push(achado);
    alvo.numeros.push(numero);
    porMateria.set(m, alvo);
    linhas.push({ numero, materia: m, ok: true, motivo: null });
  }
  function marcar(m: MateriaId) {
    const a = porMateria.get(m);
    if (a) a.ruim = true;
    else porMateria.set(m, { achados: [], checklist: { fatosNasEvidencias: false, tom: false, nadaInventado: false }, veredito: 'bloqueado', numeros: [], ruim: true });
  }

  const leituras: LeituraImportada[] = [];
  for (const [m, a] of porMateria) {
    if (a.ruim) continue;
    const ck = a.checklist;
    if (a.veredito === 'aprovado' && (a.achados.some((x) => x.gravidade === 'alta') || !(ck.fatosNasEvidencias && ck.tom && ck.nadaInventado))) {
      for (const n of a.numeros) {
        const l = linhas.find((x) => x.numero === n)!;
        l.ok = false;
        l.motivo = 'aprovado não aceita achado de gravidade alta nem checklist incompleto';
      }
      continue;
    }
    leituras.push({ materia: m, achados: a.achados, checklist: ck, veredito: a.veredito });
  }
  // matéria com qualquer linha inválida não entra: as linhas boas dela também ficam fora, com o motivo
  for (const l of linhas) if (l.ok && !leituras.some((x) => x.materia === l.materia)) { l.ok = false; l.motivo = 'outra linha desta matéria é inválida: a matéria não é importada'; }
  leituras.sort((a, b) => COM_LEITOR_2.indexOf(a.materia) - COM_LEITOR_2.indexOf(b.materia));
  return { ok: true, linhas, leituras, invalidas: linhas.filter((l) => !l.ok).length };
}

/**
 * Prévia SEM conteúdo (cegueira, PM-2026-11-23-E): só quais matérias, quantas linhas válidas e as linhas recusadas com o motivo (os motivos
 * são textos fixos, nunca o trecho). Serve antes e depois da leitura do leitor 1.
 */
export function resumoSemConteudo(r: Extract<ResultadoImportacao, { ok: true }>, max = 8): string {
  const porMateria = new Map<string, number>();
  for (const l of r.linhas) if (l.ok) porMateria.set(l.materia, (porMateria.get(l.materia) ?? 0) + 1);
  const validas = [...porMateria].map(([m, n]) => `${m}: ${n} linha(s)`).join('; ') || 'nenhuma matéria válida';
  const ruins = r.linhas.filter((l) => !l.ok);
  const recusadas = ruins.length
    ? ` Linhas recusadas (${ruins.length}): ${ruins.slice(0, max).map((l) => `linha ${l.numero}${l.materia ? ` (${l.materia})` : ''}: ${l.motivo}`).join('; ')}${ruins.length > max ? '; …' : ''}.`
    : '';
  return `Matérias válidas: ${validas}.${recusadas}`;
}