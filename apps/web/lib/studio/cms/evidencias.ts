// Evidências disponíveis para anexar a uma matéria: todas as evidências das fontes cadastradas (rotas reais /api/fontes).
import { api } from '../rotas-api';
import { ehErro } from '../backend';

export interface EvidenciaDisponivel {
  id: string;
  url: string;
  fonte: string;
  capturadoEm: string;
}

export async function evidenciasDisponiveis(): Promise<EvidenciaDisponivel[]> {
  const fontes = await api.fontes.listar();
  if (ehErro(fontes)) return [];
  const out: EvidenciaDisponivel[] = [];
  for (const f of fontes.body.data) {
    const ev = await api.fontes.evidencias(f.id);
    if (!ehErro(ev)) for (const e of ev.body.data) out.push({ id: e.id, url: e.url, fonte: f.nome, capturadoEm: e.capturadoEm });
  }
  return out;
}
