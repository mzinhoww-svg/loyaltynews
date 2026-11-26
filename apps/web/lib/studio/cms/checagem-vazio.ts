// Fila da Fábrica sem itens: o que a tela pode afirmar. Com filtro de estado, a leitura só diz que NAQUELE estado não há matéria;
// dizer que a Fábrica não entregou nada seria falso. Matéria do CMS não entra nesta fila: ela aparece na seção do CMS, acima.

export const ESTADOS_DA_FABRICA: readonly { valor: string; rotulo: string }[] = [
  { valor: 'rascunho', rotulo: 'Rascunho' },
  { valor: 'em_checagem', rotulo: 'Em checagem' },
  { valor: 'bloqueado', rotulo: 'Bloqueado' },
  { valor: 'aprovado', rotulo: 'Aprovado' },
];

export interface VazioDaFabrica {
  titulo: string;
  descricao: string;
  /** Há filtro aplicado: a tela oferece o caminho para limpar. */
  filtrado: boolean;
}

export function vazioDaFabrica(status: string): VazioDaFabrica {
  if (status) {
    const rotulo = ESTADOS_DA_FABRICA.find((e) => e.valor === status)?.rotulo ?? status;
    return {
      titulo: 'Nenhuma matéria da Fábrica com esse estado',
      descricao: `O filtro de estado “${rotulo}” não encontrou matéria na fila da Fábrica. O resultado vale só para esse estado; escolha “Todos” para ver a fila inteira.`,
      filtrado: true,
    };
  }
  return {
    titulo: 'Nenhuma matéria da Fábrica na fila',
    descricao:
      'A Fábrica editorial não entregou rascunho nenhum: a coleta e a redação rodam em comando próprio e estão desligadas nesta fase, então nada chega a esta fila. A matéria entra aqui quando a Fábrica rodar (comando manual). Matéria enviada para checagem no CMS aparece na seção “Matérias do CMS em checagem”, acima.',
    filtrado: false,
  };
}
