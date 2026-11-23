'use server';

// Piloto: mapa matéria→artigo (operador do piloto, uma vez) e leitura do leitor 1, pelas rotas da Editorial (auditadas, imutáveis). Nada publica.
import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { MATERIAS, achadosDoFormulario, ehMateria, erroDoVeredito, mapaDoFormulario } from '@/lib/studio/piloto-view';
import { requireStudio } from '../../_lib/guard';
import { texto } from '../../_lib/flash';

const LEITOR_1 = ['admin', 'editor_chefe'] as const;

function voltar(materia: string, ok: boolean, msg: string): never {
  const base = ehMateria(materia) ? `/studio/piloto/${materia}` : '/studio/piloto';
  redirect(`${base}?${new URLSearchParams({ tipo: ok ? 'ok' : 'err', aviso: msg }).toString()}`);
}

export async function fixarMapaAction(fd: FormData): Promise<void> {
  await requireStudio(LEITOR_1);
  const m = mapaDoFormulario(Object.fromEntries(MATERIAS.map((x) => [x, texto(fd, x)])));
  if (!m.ok) voltar('', false, m.erro);
  if (texto(fd, 'confirmo') !== 'sim') voltar('', false, 'Marque a confirmação: o mapa não pode ser alterado depois.');
  const r = await api.piloto.fixarMapa(m.mapa);
  voltar('', !ehErro(r), ehErro(r) ? mensagemErro(r) : `Mapa fixado para ${Object.keys(m.mapa).join(', ')}.`);
}

export async function registrarLeituraAction(fd: FormData): Promise<void> {
  await requireStudio(LEITOR_1);
  const materia = texto(fd, 'materia');
  if (!ehMateria(materia)) voltar('', false, 'Matéria inválida.');
  const linhas = [0, 1, 2, 3, 4].map((i) => ({ trecho: texto(fd, `trecho${i}`), tipo: texto(fd, `tipo${i}`), gravidade: texto(fd, `gravidade${i}`), evidenciaId: texto(fd, `evidencia${i}`) }));
  const a = achadosDoFormulario(linhas);
  if (!a.ok) voltar(materia, false, a.erro);
  const checklist = { fatosNasEvidencias: texto(fd, 'fatosNasEvidencias') === 'sim', tom: texto(fd, 'tom') === 'sim', nadaInventado: texto(fd, 'nadaInventado') === 'sim' };
  const veredito = texto(fd, 'veredito');
  const e = erroDoVeredito(veredito, a.achados, checklist);
  if (e) voltar(materia, false, e);
  const r = await api.piloto.registrar(materia, { leitor: 1, achados: a.achados, checklist, veredito: veredito as 'aprovado' | 'bloqueado' });
  voltar(
    materia,
    !ehErro(r),
    ehErro(r) ? mensagemErro(r) : `Leitura registrada e auditada: ${r.body.unsupportedFacts} fato(s) não suportado(s) (${r.body.altas} alta, ${r.body.medias} média, ${r.body.baixas} baixa).`,
  );
}
