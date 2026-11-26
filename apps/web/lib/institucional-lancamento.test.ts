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

  it('não inventa: só o e-mail da DP-54, sem rede social, CNPJ, prazo legal nem promessa de revisão humana de toda matéria; minutas jurídicas mantêm o aviso', () => {
    const tudo = JSON.stringify(INFO_DOCS);
    expect(tudo.replace(/contato@loyaltynews\.com\.br/g, '')).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); expect(tudo).not.toMatch(/linkedin\.com|instagram\.com|wa\.me|CNPJ|razão social/i);
    expect(tudo).not.toMatch(/(toda|cada) matéria (é|foi) (lida|revisada|aprovada) por (uma )?pessoa/i);
    // prazo de resposta a titular não foi definido: nenhum "em até N dias/horas", salvo a retenção do código de IP das tentativas (decidida; parecer da Security sobre f447370)
    expect(tudo.replace(/apagado em até 24 horas depois do fim da contagem ou do bloqueio/g, '')).not.toMatch(/em até \d+ (dias|horas)|prazo de \d+/i);
    expect(texto('contato')).toMatch(/demais e-mails e as redes sociais oficiais ainda não foram confirmados/);
    for (const s of ['privacidade', 'termos', 'publicidade']) expect(INFO_DOCS[s]?.draftNotice, s).toMatch(/validação jurídica/);
  });

  it('privacidade: controlador, encarregado, lead comercial e IP dizem o que está decidido (DP-54/DP-55) e deixam em aberto o que não está', () => {
    const p = texto('privacidade');
    expect(titulos('privacidade')).toEqual(expect.arrayContaining(['Pedidos comerciais (mídia kit e propostas)', 'Endereço IP e segurança']));
    // C1: controlador pessoa física por ora; encarregado no e-mail da DP-54; sem CNPJ
    expect(p).toMatch(/controlador[^]*Aurimar Nogueira, pessoa física[^]*substituída pela da empresa quando os dados dela forem informados/);
    expect(p).toMatch(/encarregado[^]*contato@loyaltynews\.com\.br/);
    // C2: dados, finalidade, bases legais, retenção da DP-55, sem venda
    for (const campo of ['nome, empresa, e-mail, WhatsApp', 'formatos de interesse', 'objetivo, mensagem']) expect(p, campo).toContain(campo);
    expect(p).toMatch(/art\. 7º, V/); expect(p).toMatch(/newsletter[^]*consentimento separado \(art\. 7º, I\)/);
    expect(p).toMatch(/política é guardar[^]*até 12 meses depois do último contato[^]*descartado por 30 dias[^]*o apagamento é automático/);
    expect(p).not.toMatch(/ainda está sendo implantada/);
    expect(p).toMatch(/Quem acessa: só a equipe comercial e a administração do portal/); expect(p).toMatch(/Não vendemos esses dados/);
    // C3 (decisões do PM de 25/11 e parecer da Security sobre f447370): tentativas = código irreversível apagado em até 24 h; auditoria = só o código, 12 meses, NUNCA "24 h"
    expect(p).toMatch(/legítimo interesse[^]*art\. 7º, IX/); expect(p).toMatch(/o IP não é guardado em claro: ele vira um código irreversível, apagado em até 24 horas depois do fim da contagem ou do bloqueio/);
    const auditoria = INFO_DOCS['privacidade']!.sections.find((s) => s.heading === 'Endereço IP e segurança')!.paragraphs!.find((x) => /auditoria/.test(x))!;
    expect(auditoria).toMatch(/guardamos só o código do IP, nunca o número, por 12 meses/); expect(auditoria).toMatch(/pseudônimo e continua sendo dado pessoal/);
    expect(auditoria).not.toMatch(/24 ?h|24 horas/); expect(p).not.toMatch(/HMAC/);
    expect(p).toMatch(/hospeda o portal pode registrar IPs[^]*ainda será confirmado/);
    // DP-54/DP-55 não são citadas na página (a DP-54 não está no governance/decisions.yaml; o registro fica em r0-preparacao)
    expect(p).not.toMatch(/DP-5[45]/i);
    expect(INFO_DOCS['privacidade']?.draftNotice).toMatch(/validação jurídica/);
  });

  it('a política não contradiz o processo real: fonte secundária é só pista, número e citação só com fonte, IA declarada com checagem independente', () => {
    const pe = texto('politica-editorial');
    expect(pe).toMatch(/Blogs e imprensa especializada servem de pista de pauta[^]*fonte primária/);
    expect(pe).toMatch(/Números, datas, valores e citações só entram no texto quando constam na fonte/);
    expect(pe).toMatch(/inteligência artificial[^]*checagem das afirmações é feita por um processo independente/);
    expect(texto('sobre')).toMatch(/automação e inteligência artificial/);
  });
});
