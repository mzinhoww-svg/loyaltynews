// Destino do backup, FORA da Vertra (ADR-012). Dois tipos:
//   - pasta local/montada:        BACKUP_DEST=D:\backups\ln   (usada nos ensaios e testes)
//   - bucket compatível com S3:    BACKUP_DEST=s3://bucket/prefixo  (exige `aws` CLI e AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
//                                  no ambiente; BACKUP_S3_ENDPOINT para provedores não-AWS)
// O provedor e o custo são decisão do proprietário (ADR-012); nada aqui contrata ou cria bucket.
import { copyFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const isS3 = (d) => d.startsWith('s3://');

function aws(args) {
  const ep = process.env.BACKUP_S3_ENDPOINT ? ['--endpoint-url', process.env.BACKUP_S3_ENDPOINT] : [];
  const r = spawnSync('aws', ['s3', ...args, ...ep], { encoding: 'utf8' });
  if (r.error) throw new Error('aws CLI indisponível (necessário só para destino s3://)');
  if (r.status !== 0) throw new Error(`aws s3 falhou (código ${r.status})`);
  return r;
}

export function putFile(dest, localPath, name) {
  if (isS3(dest)) { aws(['cp', localPath, `${dest.replace(/\/$/, '')}/${name}`, '--only-show-errors']); return; }
  mkdirSync(dest, { recursive: true });
  copyFileSync(localPath, join(dest, name));
}

export function getFile(dest, name, localPath) {
  if (isS3(dest)) { aws(['cp', `${dest.replace(/\/$/, '')}/${name}`, localPath, '--only-show-errors']); return; }
  copyFileSync(join(dest, name), localPath);
}

export function readText(dest, name, tmpDir) {
  if (isS3(dest)) { const p = join(tmpDir, name); getFile(dest, name, p); return readFileSync(p, 'utf8'); }
  const p = join(dest, name);
  if (!existsSync(p)) throw new Error(`arquivo ausente no destino: ${name}`);
  return readFileSync(p, 'utf8');
}

/** Tamanho do objeto no destino (existência + tamanho). Lança se não existir. */
export function statObject(dest, name) {
  if (isS3(dest)) {
    const m = dest.replace(/^s3:\/\//, '').replace(/\/$/, '').split('/');
    const bucket = m.shift();
    const key = [...m, name].join('/');
    const ep = process.env.BACKUP_S3_ENDPOINT ? ['--endpoint-url', process.env.BACKUP_S3_ENDPOINT] : [];
    const r = spawnSync('aws', ['s3api', 'head-object', '--bucket', bucket, '--key', key, ...ep], { encoding: 'utf8' });
    if (r.error || r.status !== 0) throw new Error(`objeto ausente no destino: ${name}`);
    return { size: Number(JSON.parse(r.stdout).ContentLength) };
  }
  const p = join(dest, name);
  if (!existsSync(p)) throw new Error(`objeto ausente no destino: ${name}`);
  return { size: statSync(p).size };
}
