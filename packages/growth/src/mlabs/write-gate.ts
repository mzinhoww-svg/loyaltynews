// Capability de escrita: o ÚNICO caminho para criar, editar ou excluir post no adaptador é apresentar o objeto de
// capability que o SocialPublisher recebeu ao se vincular ao adaptador. Sem ele (ou com um objeto forjado/outro
// publisher), a escrita é recusada antes de qualquer efeito, simulado ou real. Identidade por referência: não há
// token em texto que alguém possa copiar.

declare const writeCapabilityBrand: unique symbol;

/** Objeto opaco. Só vale a instância exata vinculada ao adaptador. */
export interface WriteCapability {
  readonly [writeCapabilityBrand]: 'mlabs-write-capability';
}

/** Cria uma capability nova e única. Ela só tem efeito depois de vinculada a UM adaptador (`bindWriteAuthority`). */
export function mintWriteCapability(): WriteCapability {
  return Object.freeze(Object.create(null)) as WriteCapability;
}

export class WriteRefused extends Error {
  readonly reason: 'sem_capability' | 'capability_ja_vinculada';
  constructor(reason: WriteRefused['reason'], message?: string) {
    super(message ?? `escrita no mLabs recusada: ${reason}`);
    this.name = 'WriteRefused';
    this.reason = reason;
  }
}

/** Guarda usada por todo adaptador (real e simulado). A capability vinculada fica em campo privado (#). */
export class WriteGate {
  #bound: WriteCapability | undefined;

  /** Vincula a capability do publicador. Só uma vez por adaptador; depois disso, outra tentativa lança. */
  bind(cap: WriteCapability): void {
    if (this.#bound !== undefined) {
      throw new WriteRefused('capability_ja_vinculada', 'este adaptador já tem um publicador vinculado');
    }
    this.#bound = cap;
  }

  /** Lança `WriteRefused` se `cap` não for exatamente a capability vinculada. */
  assert(cap: WriteCapability | undefined): void {
    if (this.#bound === undefined || cap !== this.#bound) {
      throw new WriteRefused('sem_capability');
    }
  }
}
