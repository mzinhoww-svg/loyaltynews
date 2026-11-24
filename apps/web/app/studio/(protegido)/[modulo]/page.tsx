// Módulos do Studio sem backend: tela funcional com estado vazio honesto e flag. O CMS tem rota própria (precede esta).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { flagAtiva } from '@/lib/studio/flags';
import { GRUPOS, findModule } from '@/lib/studio/modules';
import { requireModule } from '../../_lib/guard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ modulo: string }> }): Promise<Metadata> {
  const mod = findModule((await params).modulo);
  return { title: mod?.nome ?? 'Módulo' };
}

export default async function ModulePage({ params }: { params: Promise<{ modulo: string }> }) {
  const mod = findModule((await params).modulo);
  if (!mod) notFound();
  await requireModule(mod);
  const flagLigada = mod.flag ? flagAtiva(mod.flag) : false;
  return (
    <>
      <h1>{mod.nome}</h1>
      <p className="st-hint">{GRUPOS[mod.grupo]}</p>
      <p>{mod.descricao}</p>
      {mod.slug === 'configuracoes' ? (
        <section aria-labelledby="minha-conta">
          <h2 id="minha-conta">Minha conta</h2>
          <p>
            <a href="/studio/conta" data-link-conta>
              Trocar a minha senha
            </a>
          </p>
        </section>
      ) : null}
      <section className="st-empty" aria-labelledby="vazio">
        <h2 id="vazio">Nenhum dado disponível</h2>
        <p>
          Este módulo ainda não tem backend conectado, então não há registros para mostrar. Nada aqui é simulado: quando o serviço existir, os dados reais aparecem nesta tela.
        </p>
        {mod.flag ? (
          <p>
            Este módulo está <strong>{flagLigada ? 'ligado' : 'desligado nesta fase'}</strong>. Ligar é uma decisão registrada, nunca padrão de código.
          </p>
        ) : (
          <p>Aguardando o backend deste módulo.</p>
        )}
        <h3>Escopo previsto (Blueprint §5)</h3>
        <ul>
          {mod.funcoes.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        {mod.rotasBlueprint ? (
          <p className="st-hint">Rotas do Blueprint cobertas: {mod.rotasBlueprint.join(', ')}</p>
        ) : null}
      </section>
    </>
  );
}
