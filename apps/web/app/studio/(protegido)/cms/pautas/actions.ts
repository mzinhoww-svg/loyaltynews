'use server';

import { redirect } from 'next/navigation';
import { sourceTier, type SourceKind } from '@ln/editorial';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { fontesDeAncora, montarPauta, MAX_ANCORAS, type FonteRegistro } from '@/lib/studio/cms/pauta';
import { requireStudio } from '../../../_lib/guard';

const BASE = '/studio/cms/pautas';
const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
const volta = (ok: boolean, msg: string): never => redirect(`${BASE}?tipo=${ok ? 'ok' : 'err'}&aviso=${encodeURIComponent(msg)}`);

/**
 * Pauta AUTORAL escrita por pessoa da redação (admin, editor-chefe, editor). Âncoras só em fontes PRIMÁRIAS HABILITADAS (conferido aqui e,
 * de novo, pelo Backend). A rota só registra a pauta na fila: quem a processa é o worker, e a matéria resultante entra na revisão comum.
 * Nada é publicado por aqui.
 */
export async function enviarPautaAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe', 'editor']);
  const reg = await api.editorial.fontesRegistro();
  if (ehErro(reg)) return volta(false, mensagemErro(reg));
  const permitidas = fontesDeAncora((reg.body as { items: FonteRegistro[] }).items, (k) => sourceTier(k as SourceKind) === 'primary');
  const ancoras = Array.from({ length: MAX_ANCORAS }, (_, i) => ({ fonteId: t(fd, `fonte-${i}`), url: t(fd, `url-${i}`) }));
  const m = montarPauta({ id: t(fd, 'id'), titulo: t(fd, 'titulo'), angulo: t(fd, 'angulo'), formato: t(fd, 'formato'), editoria: t(fd, 'editoria'), ancoras }, permitidas);
  if (!m.ok) return volta(false, m.erro);
  const r = await api.editorial.enviarPauta(m.corpo);
  volta(!ehErro(r), ehErro(r) ? mensagemErro(r) : `Pauta “${m.corpo.id}” registrada na fila. O worker a processa e a matéria entra na fila de revisão; nada é publicado.`);
}
