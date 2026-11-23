'use server';

// Importação auditada da folha do leitor 2 (QA 3) pelas rotas da Editorial (PM-2026-11-23-C e -E). Só o leitor 1 (admin ou editor-chefe).
// Passo "validar": valida o CSV, registra o hash no primeiro envio (mesmo sem importar) e mostra uma prévia SEM conteúdo.
// Passo "importar": tudo ou nada, só se o leitor 1 já leu todas as matérias da folha (o servidor também recusa com 409 LEITOR1_PENDENTE).
import { createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { MAX_BYTES, resumoSemConteudo, validarFolha } from '@/lib/studio/piloto-importacao';
import { requireStudio } from '../../../_lib/guard';
import { texto } from '../../../_lib/flash';

const BASE = '/studio/piloto/importar';
function voltar(ok: boolean, msg: string): never {
  redirect(`${BASE}?${new URLSearchParams({ tipo: ok ? 'ok' : 'err', aviso: msg }).toString()}`);
}

export async function importarFolhaAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe']);
  const arquivo = fd.get('arquivo');
  if (!(arquivo instanceof File) || arquivo.size === 0) voltar(false, 'Escolha o arquivo CSV da folha do leitor 2.');
  if (arquivo.size > MAX_BYTES) voltar(false, `Arquivo maior que ${MAX_BYTES / 1000} KB.`);
  const leitor2Nome = texto(fd, 'leitor2Nome');
  if (leitor2Nome.length < 2 || leitor2Nome.length > 80) voltar(false, 'Informe quem leu a folha (de 2 a 80 caracteres), por exemplo "QA 3".');
  const bytes = Buffer.from(await arquivo.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const v = validarFolha(bytes.toString('utf8'));
  if (!v.ok) voltar(false, v.erro);
  const meta = { nome: arquivo.name.slice(0, 200) || 'folha.csv', sha256, linhas: v.linhas.length };
  const materias = [...new Set(v.linhas.map((l) => l.materia).filter((m) => ['a1', 'a4', 'a6', 'a9'].includes(m)))];
  const resumo = resumoSemConteudo(v);
  const curto = sha256.slice(0, 12);

  // 1) o hash é gravado no primeiro envio, antes de qualquer prévia (PM-2026-11-23-E)
  if (materias.length) {
    const reg = await api.piloto.registrarFolha({ arquivo: meta, leitor2Nome, materias });
    if (ehErro(reg)) voltar(false, `Folha ${curto}… não registrada: ${mensagemErro(reg)} ${resumo}`);
  }
  if (texto(fd, 'passo') !== 'importar') voltar(true, `Folha ${meta.nome} (sha256 ${curto}…) registrada. Prévia, sem conteúdo: ${resumo}`);

  // 2) importar: tudo ou nada
  if (texto(fd, 'confirmo') !== 'sim') voltar(false, `Marque a confirmação para importar. ${resumo}`);
  if (v.invalidas > 0) voltar(false, `Nada foi importado: a folha tem linhas recusadas. Corrija o arquivo e envie de novo. ${resumo}`);
  const lista = await api.piloto.materias();
  if (ehErro(lista)) voltar(false, mensagemErro(lista));
  const pendentes = v.leituras.filter((l) => !lista.body.items.find((i) => i.materia === l.materia)?.leituras.leitor1).map((l) => l.materia);
  if (pendentes.length) voltar(false, `Nada foi importado: registre antes a sua leitura de ${pendentes.join(', ')} (leitura cega). O hash da folha já ficou registrado.`);
  const r = await api.piloto.importar({ arquivo: meta, leitor2Nome, leituras: v.leituras });
  if (ehErro(r)) voltar(false, `Nada foi importado: ${mensagemErro(r)}`);
  voltar(true, `Importadas como leitura do leitor 2 (${leitor2Nome}): ${r.body.importadas.map((i) => `${i.materia} (${i.altas} alta, ${i.medias} média, ${i.baixas} baixa)`).join('; ')}. Folha sha256 ${curto}….`);
}
