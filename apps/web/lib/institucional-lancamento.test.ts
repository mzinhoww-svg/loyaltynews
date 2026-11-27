import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASSINATURA, ILLUSTRATION_LABEL } from '@ln/contracts';
import { AUTORAL_LABEL } from '@ln/editorial';
import { INFO_DOCS } from '../app/(portal)/_lib/institutional';
import { EMPRESA } from '../app/(portal)/_lib/contato';
import { POLITICA_COOKIES_VERSAO } from '../app/(portal)/_consentimento/regras';

// Conteúdo institucional do lançamento (www.loyaltynews.com.br): o que o texto afirma tem de ser o que o produto faz, e o que ainda não está definido
// (endereço, nome do encarregado, e-mails, redes) continua sem ser inventado. Privacidade: texto aprovado na DP-68 (v0.5, 7C5F07D0); empresa: DP-68.
const texto = (slug: string) => JSON.stringify(INFO_DOCS[slug]);
const ler = (caminho: string) => readFileSync(fileURLToPath(new URL(caminho, import.meta.url)), 'utf8');
const titulos = (slug: string) => INFO_DOCS[slug]!.sections.map((s) => s.heading);

describe('institucional do lançamento', () => {
  it('as seis páginas pedidas existem com as seções esperadas', () => {
    expect(INFO_DOCS['sobre']!.title).toBe('Quem somos');
    expect(titulos('sobre')).toEqual(expect.arrayContaining(['O que cobrimos', 'Quem produz', 'De onde vem a informação', 'Independência']));
    expect(titulos('politica-editorial')).toEqual(expect.arrayContaining(['Princípios', 'Fontes e atribuição', 'Autoria e uso de inteligência artificial', 'Formatos', 'Imagens e ilustrações', 'Conteúdo patrocinado', 'Erros e correções']));
    expect(titulos('correcoes')).toEqual(expect.arrayContaining(['Correções', 'Direito de resposta e pedidos de remoção', 'Créditos e direitos autorais', 'Pedidos de titulares de dados']));
    expect(titulos('privacidade')).toEqual([
      '1. Quem responde pelos seus dados', '2. Quais dados tratamos', '3. Pedidos comerciais', '4. Correção e remoção de dados', '5. Direito de resposta', '6. Seus direitos',
      '7. Painel interno', '8. Cookies e medição de audiência', '9. Segurança e endereço IP', '10. Quem mais processa os dados', '11. Alterações',
    ]);
    expect(INFO_DOCS['privacidade']!.sections.filter((s) => s.id === 'cookies').map((s) => s.heading)).toEqual(['8. Cookies e medição de audiência']);
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

  it('não inventa: só o e-mail da DP-54 e a empresa da DP-68, sem rede social, outro CNPJ, prazo não decidido nem promessa de revisão humana de toda matéria; minutas mantêm o aviso', () => {
    const tudo = JSON.stringify(INFO_DOCS);
    expect(tudo.replace(/contato@loyaltynews\.com\.br/g, '')).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); expect(tudo).not.toMatch(/linkedin\.com|instagram\.com|wa\.me/i);
    // razão social e CNPJ: só os informados pelo proprietário (DP-68); nenhum outro número, pessoa física, endereço ou parecer
    const semEmpresa = tudo.replace(/REINERS MEDIA LTDA/g, '').replace(/CNPJ:? 66\.084\.338\/0001-87/g, '');
    expect(semEmpresa).not.toMatch(/CNPJ|razão social: [^.]|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|LTDA/i);
    expect(tudo).not.toMatch(/Aurimar|pessoa física|CEP \d|parecer jurídico|revisad[oa] por advogad/i);
    expect(tudo).not.toMatch(/(toda|cada) matéria (é|foi) (lida|revisada|aprovada) por (uma )?pessoa/i);
    // o único prazo de resposta prometido é o de 15 dias corridos (já no produto: PRAZO_DIAS; texto aprovado na DP-68); nenhum outro "em até N dias/horas"
    expect(tudo.replace(/em até 15 dias corridos/g, '')).not.toMatch(/em até \d+ (dias|horas)|prazo de \d+/i);
    expect(tudo).not.toMatch(/(?<!até )\b(?!15 )\d+ dias corridos/);
    expect(texto('contato')).toMatch(/demais e-mails e as redes sociais oficiais ainda não foram confirmados/);
    for (const s of ['privacidade', 'termos', 'publicidade']) expect(INFO_DOCS[s]?.draftNotice, s).toMatch(/validação jurídica/);
  });

  it('privacidade: empresa como controlador, contato, encarregado não informado, e só promessas que valem hoje', () => {
    const p = texto('privacidade');
    expect(p).toContain('O controlador dos dados pessoais tratados neste portal é a REINERS MEDIA LTDA, CNPJ 66.084.338/0001-87.');
    expect(p).toMatch(/canal para falar sobre privacidade é contato@loyaltynews\.com\.br[^]*nome da pessoa encarregada ainda não foi informado/);
    for (const campo of ['nome, empresa, e-mail, WhatsApp', 'objetivo, mensagem', 'marcação sobre a newsletter', 'trecho contestado', 'Contatos comerciais registrados']) expect(p, campo).toContain(campo);
    expect(p).not.toMatch(/formatos de interesse/);
    expect(p).toMatch(/art\. 7º, V\)/); expect(p).toMatch(/consentimento separado \(art\. 7º, I\)/); expect(p).toMatch(/legítimo interesse \(art\. 7º, IX\)/);
    expect(p).toMatch(/Não vendemos esses dados/);
    // o que NÃO roda hoje é dito como não ativo; nenhuma promessa de apagamento automático, prazo de guarda ou descadastro
    expect(p).toMatch(/Hoje não há apagamento automático em funcionamento/); expect(p).toMatch(/limpeza periódica dessas contagens ainda não está ativa/);
    expect(p).not.toMatch(/apagamento é automático|12 meses|30 dias|24 horas|descadastro/i);
    expect(p).toMatch(/Hoje o sistema do portal não usa o seu endereço IP para limitar tentativas nem registra código de IP na auditoria/);
    expect(p).not.toMatch(/sem dado pessoal|IP anonimizado|por até 2 anos/i);
    // login: a auditoria grava um código no lugar do e-mail (PR #74); linhas antigas são declaradas
    expect(p).toMatch(/grava na auditoria um código no lugar do e-mail digitado[^]*pseudônimo e continua sendo dado pessoal[^]*anteriores a essa mudança guardam o e-mail digitado; eles não são apagados/);
    expect(p).not.toMatch(/grava na auditoria o e-mail digitado|e-mail digitado em texto legível/);
    expect(p).toMatch(/Cloudflare[^]*Vertra/);
    expect(p).not.toMatch(/DP-\d|HMAC/);
    expect(INFO_DOCS['privacidade']?.draftNotice).toBe('Minuta v0.5, sujeita à validação jurídica.');
    expect(INFO_DOCS['privacidade']!.sections.at(-1)!.paragraphs).toEqual(['Versão 0.5, aprovada em 27/11/2026.']);
    expect(p).not.toMatch(/quando o texto for aprovado|Esta política é uma minuta/);
  });

  it('o código sustenta o que a privacidade diz sobre o login: o e-mail digitado não vai à auditoria', () => {
    const handler = ler('../../../packages/auth/src/handler.ts');
    expect(handler).toMatch(/const emailRef = auditEmail\(email\)/);
    expect(handler).not.toMatch(/detalhe: \{ email\b/);
  });

  it('as outras páginas não contradizem o texto: correções, contato, The Loyal, aviso de cookies, formulário, rodapé e termos', () => {
    expect(texto('correcoes')).toMatch(/Correção e remoção são pedidas pelo formulário desta página; o direito de resposta, por contato@loyaltynews\.com\.br/);
    expect(texto('correcoes')).not.toMatch(/canal do encarregado/);
    expect(texto('contato')).toMatch(/Notificação de direitos autorais, direito de resposta e demais pedidos de titulares de dados: escreva para contato@loyaltynews\.com\.br/);
    // notificação autoral vai por e-mail (o formulário só cobre dado pessoal), sem prazo novo (DP-69)
    expect(texto('correcoes')).toContain('podem enviar notificação para contato@loyaltynews.com.br; analisamos, retiramos quando cabível e mantemos registro do prazo e da decisão.');
    expect(texto('correcoes') + texto('contato')).not.toMatch(/formulário abaixo|notificação de direitos autorais[^.\]]*formulário/i);
    expect(texto('contato')).not.toMatch(/direito de resposta, notificação|e pedidos de titulares de dados: use o formulário|canal do encarregado/);
    for (const slug of ['termos', 'contato']) expect(texto(slug), slug).toContain('Razão social: REINERS MEDIA LTDA. CNPJ: 66.084.338/0001-87.');
    const loyal = ler('../app/(portal)/the-loyal/page.tsx');
    expect(loyal).not.toMatch(/Nenhum e-mail é coletado/); expect(loyal).toMatch(/registramos, se você marcar, o interesse na newsletter\. Nada é enviado hoje/);
    const banner = ler('../app/(portal)/_consentimento/Consentimento.tsx').replace(/\s+/g, ' ');
    expect(banner).not.toMatch(/sem dados pessoais/); expect(banner).toMatch(/identificadores, que são dados pessoais/);
    expect(POLITICA_COOKIES_VERSAO).toBe('2026-11-27'); // o texto mudou: o consentimento anterior deixa de valer
    expect(ler('../app/(portal)/_titular/PedidoTitularForm.tsx')).not.toMatch(/canal do encarregado/);
    expect(ler('../app/(portal)/_components/SiteFooter.tsx')).toMatch(/\{EMPRESA\.razaoSocial\} · CNPJ \{EMPRESA\.cnpj\}/);
    expect(EMPRESA).toEqual({ razaoSocial: 'REINERS MEDIA LTDA', cnpj: '66.084.338/0001-87' });
  });

  it('a política não contradiz o processo real: fonte secundária é só pista, número e citação só com fonte, IA declarada com checagem independente', () => {
    const pe = texto('politica-editorial');
    expect(pe).toMatch(/Blogs e imprensa especializada servem de pista de pauta[^]*fonte primária/);
    expect(pe).toMatch(/Números, datas, valores e citações só entram no texto quando constam na fonte/);
    expect(pe).toMatch(/inteligência artificial[^]*checagem das afirmações é feita por um processo independente/);
    expect(texto('sobre')).toMatch(/automação e inteligência artificial/);
  });
});
