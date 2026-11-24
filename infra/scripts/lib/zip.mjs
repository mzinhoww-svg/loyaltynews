// Leitura PORTÁTIL do índice de um ZIP (sem tar, sem unzip, sem dependência): serve para conferir o ZIP gerado por `git archive --format=zip` (package-web) ou pelo bsdtar (package-prebuilt).
// Motivo: o `tar` GNU do Ubuntu (runner do GitHub Actions) NÃO lê nem escreve ZIP; `tar -tf x.zip` sai sem listar nada e o pacote reprovava com "pasta (1490 arquivos) e ZIP (0) divergem".
// Só lê o diretório central (fim do arquivo): não descomprime nada. Limites: sem ZIP64 (até 65534 entradas e 4 GB: o limite do upload da Vertra é 100 MB) e sem ZIP de vários discos.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/** Pura: nomes das ENTRADAS (inclusive pastas, que terminam em `/`) do ZIP em `buf`, na ordem do diretório central. Lança Error se o ZIP for inválido ou ZIP64. */
export function nomesDoZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('ZIP inválido: menor que o registro de fim (22 bytes)');
  // o registro de fim (EOCD) fica no fim; pode ser seguido por um comentário de até 65535 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido: registro de fim não encontrado');
  const total = buf.readUInt16LE(eocd + 10);
  const tamanhoCentral = buf.readUInt32LE(eocd + 12);
  const inicioCentral = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || tamanhoCentral === 0xffffffff || inicioCentral === 0xffffffff) throw new Error('ZIP64 não suportado por este leitor');
  if (inicioCentral + tamanhoCentral > eocd) throw new Error('ZIP inválido: diretório central fora dos limites');
  const nomes = [];
  let p = inicioCentral;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new Error(`ZIP inválido: entrada ${n} do diretório central corrompida`);
    const flags = buf.readUInt16LE(p + 8);
    const nome = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comentario = buf.readUInt16LE(p + 32);
    if (p + 46 + nome > buf.length) throw new Error(`ZIP inválido: nome da entrada ${n} fora dos limites`);
    // sem o bit 11 o nome é CP437 (ASCII é igual); com ele, UTF-8. Só a contagem e os nomes ASCII importam aqui.
    nomes.push(buf.toString(flags & 0x0800 ? 'utf8' : 'latin1', p + 46, p + 46 + nome));
    p += 46 + nome + extra + comentario;
  }
  return nomes;
}

/** Nomes dos ARQUIVOS (sem as pastas) do ZIP em `caminho`. Lê só o fim do arquivo (o diretório central), não o ZIP inteiro quando ele é grande. */
export function arquivosDoZip(caminho) {
  const fd = openSync(caminho, 'r');
  try {
    const tam = fstatSync(fd).size;
    // o diretório central cabe numa janela: 22 (fim) + 65535 (comentário) + a tabela; lê do início do central, que o fim indica
    const cauda = Buffer.alloc(Math.min(tam, 22 + 65535));
    readSync(fd, cauda, 0, cauda.length, tam - cauda.length);
    let eocd = -1;
    for (let i = cauda.length - 22; i >= 0; i--) {
      if (cauda.readUInt32LE(i) === EOCD && i + 22 + cauda.readUInt16LE(i + 20) === cauda.length) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP inválido: registro de fim não encontrado');
    const inicioCentral = cauda.readUInt32LE(eocd + 16);
    if (inicioCentral === 0xffffffff) throw new Error('ZIP64 não suportado por este leitor');
    const resto = Buffer.alloc(tam - inicioCentral);
    readSync(fd, resto, 0, resto.length, inicioCentral);
    // remonta um buffer só com [central + fim], ajustando o deslocamento do central para 0
    const copia = Buffer.from(resto);
    copia.writeUInt32LE(0, copia.length - (cauda.length - eocd) + 16);
    return nomesDoZip(copia).filter((n) => !n.endsWith('/'));
  } finally { closeSync(fd); }
}
