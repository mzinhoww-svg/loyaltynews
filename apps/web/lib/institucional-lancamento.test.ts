import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASSINATURA, ILLUSTRATION_LABEL } from '@ln/contracts';
import { AUTORAL_LABEL } from '@ln/editorial';
import { INFO_DOCS } from '../app/(portal)/_lib/institutional';

// Conteúdo institucional do lançamento (www.loyaltynews.com.br): o que o texto afirma tem de ser o que o produto faz, e o que ainda não está definido
// (controlador, e-mails, redes) continua sem ser inventado.
const texto = (slug: string) => JSON.stringify(INFO_DOCS[slug]);
const titulos = (slug: string) => INFO_DOCS[slug]!.sections.map((s) => s.heading);

describe('institucional do lançamento', () => {
  it('as seis páginas pedidas existem com as seções esperadas', () => {
    expect(INFO_DOCS['sobre']!.title).toBe('Quem somos');
    expect(titulos('sobre')).toEqual(expect.arrayContaining(['O que cobrimos', 'Quem produz', 'De onde vem a informação', 'Independência']));
    expect(titulos('politica-editorial')).toEqual(expect.arrayContaining(['Princípios', 'Fontes e atribuição', 'Autoria e uso de inteligência artificial', 'Formatos', 'Imagens e ilustrações', 'Conteúdo patrocinado', 'Erros e correções']));
    expect(titulos('correcoes')).toEqual(expect.arrayContaining(['Correções', 'Direito de resposta e pedidos de remoção', 'Créditos e direitos autorais', 'Pedidos de titulares de dados']));
    expect(titulos('privacidade')).toEqual(expect.arrayContaining(['Controlador e contato do encarregado', 'Quais dados tratamos', 'Direitos do titular', 'Cookies e medição']));
    expect(titulos('termos')).toEqual(expect.arrayContaining(['Uso do conteúdo', 'Natureza das informações', 'Responsabilidade', 'Alterações']));
    expect(titulos('contato')).toEqual(expect.arrayContaining(['Pedidos que já têm canal', 'Demais canais', 'Assuntos']));
  });

  it('o que o texto promete bate com o produto: assinatura, rótulo de ilustração, aviso autoral e campos do formulário de pedidos', () => {
    expect(texto('politica-editorial')).toContain(ASSINATURA); expect(ASSINATURA).toBe('Redação Loyalty News');
    expect(texto('politica-editorial')).toContain(ILLUSTRATION_LABEL);
    expect(AUTORAL_LABEL).toMatch(/^Conteúdo autoral da Redação Loyalty News/); // o aviso que a política descreve
    expect(texto('politica-editorial')).toMatch(/Conteúdo autoral[^]*aviso no início[^]*não traz falas/);
    const form = readFileSync(fileURLToPath(new URL('../app/(portal)/_titular/PedidoTitularForm.tsx', import.meta.url)), 'utf8');
    for (const campo of ['name="nome"', 'name="contato"', 'name="url"', 'name="tipo"', 'name="texto"']) expect(form, campo).toContain(campo);
    expect(texto('correcoes')).toMatch(/seu nome, um e-mail para resposta, o endereço da página, o tipo do pedido e a descrição/);
    expect(texto('privacidade')).toMatch(/nome, e-mail para resposta, endereço da página, tipo e descrição do pedido/);
    for (const slug of ['correcoes', 'privacidade', 'contato']) expect(texto(slug), slug).toContain('/correcoes#pedido');
  });

  it('não inventa: sem e-mail, rede social, controlador, prazo legal nem promessa de revisão humana de toda matéria; minutas jurídicas mantêm o aviso', () => {
    const tudo = JSON.stringify(INFO_DOCS);
    expect(tudo).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); expect(tudo).not.toMatch(/linkedin\.com|instagram\.com|wa\.me|CNPJ|razão social/i);
    expect(tudo).not.toMatch(/(toda|cada) matéria (é|foi) (lida|revisada|aprovada) por (uma )?pessoa/i);
    expect(tudo).not.toMatch(/em até \d+ (dias|horas)|prazo de \d+/i);
    expect(texto('privacidade')).toMatch(/pendência de governança R1-01/); // controlador ainda não definido: segue dito, não inventado
    expect(texto('contato')).toMatch(/ainda não foram confirmados/);
    for (const s of ['privacidade', 'termos', 'publicidade']) expect(INFO_DOCS[s]?.draftNotice, s).toMatch(/validação jurídica/);
  });

  it('a política não contradiz o processo real: fonte secundária é só pista, número e citação só com fonte, IA declarada com checagem independente', () => {
    const pe = texto('politica-editorial');
    expect(pe).toMatch(/Blogs e imprensa especializada servem de pista de pauta[^]*fonte primária/);
    expect(pe).toMatch(/Números, datas, valores e citações só entram no texto quando constam na fonte/);
    expect(pe).toMatch(/inteligência artificial[^]*checagem das afirmações é feita por um processo independente/);
    expect(texto('sobre')).toMatch(/automação e inteligência artificial/);
  });
});
