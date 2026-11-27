import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Lead } from '@ln/contracts';
import { PropostaForm } from '../app/(portal)/_proposta/PropostaForm';
import { corpoDaProposta, estadoDaProposta, OBJETIVOS, ROTA_PROPOSTA, validarProposta, type PropostaValores } from '../app/(portal)/_proposta/proposta';

const ok = (over: Partial<PropostaValores> = {}): PropostaValores => ({
  nome: 'Ana Souza', empresa: 'Programa Alfa', email: 'ana@alfa.example', whatsapp: '', objetivo: OBJETIVOS[0], mensagem: '', optInNewsletter: false, ...over,
});
// O mesmo molde que a rota pública usa (handlers.ts: submitLead): campos a mais são recusados.
const MOLDE = Lead.omit({ id: true, consentimentoEm: true, classeDeDado: true }).strict();

describe('pedido de proposta: validação do portal (espelha o contrato do Backend)', () => {
  it('só nome, empresa, e-mail e objetivo são obrigatórios; WhatsApp e mensagem são opcionais', () => {
    expect(validarProposta(ok())).toEqual({});
    expect(Object.keys(validarProposta(ok({ nome: '', empresa: '', email: '', objetivo: '' }))).sort()).toEqual(['email', 'empresa', 'nome', 'objetivo']);
  });
  it('limites: nome e empresa de 2 a 200, e-mail válido até 320, WhatsApp com 8 dígitos ou em branco, mensagem até 4.000', () => {
    expect(validarProposta(ok({ nome: 'A' })).nome).toBeDefined();
    expect(validarProposta(ok({ nome: 'A'.repeat(201) })).nome).toBeDefined();
    expect(validarProposta(ok({ nome: 'A'.repeat(200) })).nome).toBeUndefined();
    expect(validarProposta(ok({ empresa: 'B'.repeat(201) })).empresa).toBeDefined();
    expect(validarProposta(ok({ email: 'sem-arroba' })).email).toBeDefined();
    expect(validarProposta(ok({ email: `${'a'.repeat(316)}@x.co` })).email).toBeDefined();
    expect(validarProposta(ok({ whatsapp: '+ 12 3' })).whatsapp).toBeDefined(); // poucos dígitos
    expect(validarProposta(ok({ whatsapp: '(11) 91234-5678' })).whatsapp).toBeUndefined();
    expect(validarProposta(ok({ mensagem: 'm'.repeat(4001) })).mensagem).toBeDefined();
    expect(validarProposta(ok({ mensagem: 'm'.repeat(4000) })).mensagem).toBeUndefined();
  });
  it('o objetivo é uma das opções da lista (texto livre é recusado)', () => {
    expect(validarProposta(ok({ objetivo: 'qualquer coisa' })).objetivo).toBeDefined();
    for (const o of OBJETIVOS) expect(validarProposta(ok({ objetivo: o })).objetivo, o).toBeUndefined();
  });
});

describe('pedido de proposta: corpo enviado', () => {
  it('é aceito pelo molde estrito do contrato, com e sem os opcionais', () => {
    expect(MOLDE.safeParse(corpoDaProposta(ok())).success).toBe(true);
    expect(MOLDE.safeParse(corpoDaProposta(ok({ whatsapp: ' 11 91234-5678 ', mensagem: ' olá ', optInNewsletter: true }))).success).toBe(true);
  });
  it('opcionais vazios ficam de fora (nada de string vazia), espaços são aparados e o opt-in só vai marcado se a pessoa marcou', () => {
    const vazio = corpoDaProposta(ok({ nome: '  Ana  ' }));
    expect(vazio).not.toHaveProperty('whatsapp');
    expect(vazio).not.toHaveProperty('mensagem');
    expect(vazio).toMatchObject({ nome: 'Ana', optInNewsletter: false, formatosInteresse: [] });
    expect(corpoDaProposta(ok({ optInNewsletter: true }))).toMatchObject({ optInNewsletter: true });
  });
  it('não envia nada além do contrato: nem o campo escondido (honeypot) nem dado de navegação', () => {
    expect(Object.keys(corpoDaProposta(ok({ whatsapp: '11912345678', mensagem: 'x' }))).sort()).toEqual(
      ['email', 'empresa', 'formatosInteresse', 'mensagem', 'nome', 'objetivo', 'optInNewsletter', 'whatsapp'],
    );
  });
  it('vai para a rota pública do módulo comercial, na mesma origem', () => {
    expect(ROTA_PROPOSTA).toBe('/api/commercial/leads');
  });
});

describe('pedido de proposta: resposta do servidor vira estado da tela', () => {
  it('201 recebido; 400/413/415/422 inválido; 429 muitos; o resto falha', () => {
    expect(estadoDaProposta(201)).toBe('recebido');
    for (const s of [400, 413, 415, 422]) expect(estadoDaProposta(s), String(s)).toBe('invalido');
    expect(estadoDaProposta(429)).toBe('muitos');
    for (const s of [401, 403, 404, 500, 502, 503]) expect(estadoDaProposta(s), String(s)).toBe('falha');
  });
});

describe('pedido de proposta: formulário (marcação de servidor)', () => {
  const html = renderToStaticMarkup(createElement(PropostaForm));
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  it('traz os campos, com rótulo, e o botão só habilita depois da hidratação', () => {
    for (const nome of ['nome', 'empresa', 'email', 'whatsapp', 'objetivo', 'mensagem']) expect(html, nome).toContain(`name="${nome}"`);
    expect(html).toMatch(/<button[^>]*disabled/); // antes de hidratar: sem envio nativo
    expect(html).toContain('noValidate=""');
  });
  it('o opt-in da newsletter é separado e vem DESMARCADO', () => {
    const m = /<input[^>]*name="optInNewsletter"[^>]*>/.exec(html);
    expect(m).not.toBeNull();
    expect(m![0]).not.toContain('checked');
    expect(texto).toContain('opcional, separado do pedido');
  });
  it('diz a finalidade, o que é gravado e aponta a política de privacidade', () => {
    expect(texto).toContain('Usaremos nome, empresa, e-mail, objetivo e, se informado, WhatsApp e mensagem para responder ao pedido de proposta ou de mídia kit e conduzir a negociação.');
    expect(texto).toContain('Se você marcar a opção abaixo, registramos o interesse na newsletter; nada é enviado hoje.');
    expect(texto).toContain('Tenho interesse na newsletter do Loyalty News (opcional, separado do pedido)');
    expect(texto).not.toMatch(/só para responder|quero receber/i); // contradizia os itens 2 e 3 da privacidade; o rótulo não promete envio
    expect(texto).toContain('data e a hora do envio');
    expect(html).toContain('href="/privacidade"');
  });
  it('tem o campo escondido contra robô, fora da tabulação e escondido do leitor de tela', () => {
    const bloco = /<div aria-hidden="true"[^>]*>[^]*?<\/div>/.exec(html);
    expect(bloco).not.toBeNull();
    const campo = /<input[^>]*name="site"[^>]*>/.exec(bloco![0]);
    expect(campo).not.toBeNull();
    expect(campo![0]).toContain('tabindex="-1"');
    expect(campo![0]).toContain('autoComplete="off"');
  });
  it('avisa que pedir proposta não é compra nem reserva', () => {
    expect(texto).toContain('não é uma compra nem reserva');
  });
});

describe('/midia-kit: formulário e botão de PDF', () => {
  const page = readFileSync(new URL('../app/(portal)/midia-kit/page.tsx', import.meta.url), 'utf8');
  it('o formulário só entra com a flag portalFormularios (ADR-022), lida em execução pelo helper formulariosAtivos', () => {
    expect(page).toContain("formulariosAtivos()");
    expect(page).toMatch(/\{formulario && \(\s*<section id="proposta"/);
  });
  it('com a flag desligada o botão principal continua indo a /contato', () => {
    expect(page).toMatch(/formulario \? \(\s*<a href="#proposta"[^>]*>Solicitar proposta<\/a>\s*\) : \(\s*<Link href="\/contato"/);
  });
  it('controles que não fazem sentido no papel saem na impressão', () => {
    expect(page).toMatch(/className="pt-no-print"/);
    expect(page).toContain('pt-chips pt-no-print');
    const css = readFileSync(new URL('../app/(portal)/portal.css', import.meta.url), 'utf8');
    expect(css).toMatch(/@media print \{[^}]*[^]*\.pt-no-print \{ display: none !important; \}/);
  });
});
