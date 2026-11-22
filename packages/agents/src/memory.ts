/**
 * Memória setorial por editoria (ADR-004: memória de trabalho no PostgreSQL, por redação,
 * não no agente). Append-only e versionada; só o editor e o redator da editoria (e o diretor
 * editorial) escrevem; leitura aberta aos perfis com `read_evidence`/`read_approved`.
 */
import type { Organization } from './organization';
import { EditoriaSchema, type Editoria } from './schemas';
import { MEMORY_KINDS, type MemoryKind, type SectorMemoryEntry, type Store } from './store';

export class SectorMemoryService {
  constructor(private readonly store: Store, private readonly org: Organization) {}

  private writers(editoria: Editoria): Set<string> {
    const n = this.org.newsrooms.find((x) => x.editoria === editoria);
    if (!n) throw new Error(`redação inexistente: ${editoria}`);
    return new Set([n.editor, n.writer, n.director]);
  }

  async write(input: {
    editoria: string;
    kind: MemoryKind;
    key: string;
    content: unknown;
    author_agent_id: string;
    source_refs?: string[];
  }): Promise<SectorMemoryEntry> {
    const editoria = EditoriaSchema.parse(input.editoria);
    if (!MEMORY_KINDS.includes(input.kind)) throw new Error(`tipo de memória inválido: ${input.kind}`);
    if (!input.key.trim()) throw new Error('chave obrigatória');
    if (!this.writers(editoria).has(input.author_agent_id))
      throw new Error(`${input.author_agent_id} não pode escrever na memória da editoria ${editoria}`);
    return this.store.appendMemory({
      editoria,
      kind: input.kind,
      key: input.key,
      content: input.content,
      source_refs: input.source_refs ?? [],
      author_agent_id: input.author_agent_id,
    });
  }

  read(editoria: Editoria, key: string) {
    return this.store.getMemory(editoria, key);
  }
  list(editoria: Editoria, kind?: MemoryKind) {
    return this.store.listMemory(editoria, kind);
  }
  history(editoria: Editoria, key: string) {
    return this.store.memoryHistory(editoria, key);
  }
}
