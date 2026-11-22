// INTERNO: este módulo NÃO é reexportado pelo índice nem por nenhum subpath de `@ln/growth` (há teste que prova isso).
// Capability de escrita: o ÚNICO caminho para criar, editar ou excluir post num adaptador é apresentar o objeto de
// capability que o publicador recebeu ao ser criado. Quem cria o adaptador, minta a capability e a vincula no mesmo
// passo é `createSocialPublisher` (publisher.ts); nenhum código fora do pacote consegue mintar ou vincular.
// Identidade por referência: não há token em texto que alguém possa copiar.
import { WriteRefused } from './errors';

declare const writeCapabilityBrand: unique symbol;

/** Objeto opaco. Só vale a instância exata vinculada ao adaptador. */
export interface WriteCapability {
  readonly [writeCapabilityBrand]: 'mlabs-write-capability';
}

/** Cria uma capability nova e única. Só tem efeito depois de vinculada a UM adaptador. */
export function mintWriteCapability(): WriteCapability {
  return Object.freeze(Object.create(null)) as WriteCapability;
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
