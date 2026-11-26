/**
 * Pedido de proposta comercial (mídia kit). Regras de validação do lado do portal, iguais às do contrato do Backend
 * (`Lead` em @ln/contracts, rota pública POST /api/commercial/leads). O Backend continua decidindo; aqui é só para orientar o leitor antes de enviar.
 * Minimização (LGPD): só nome, empresa e e-mail são obrigatórios; WhatsApp e mensagem são opcionais; o opt-in da newsletter é separado e começa desmarcado.
 */
export const ROTA_PROPOSTA = '/api/commercial/leads';

/** O contrato exige um objetivo; a lista fechada evita texto livre (e dado pessoal digitado sem querer) nesse campo. */
export const OBJETIVOS = [
  'Divulgar a marca',
  'Gerar contatos (leads)',
  'Lançar produto ou campanha',
  'Patrocinar conteúdo ou evento',
  'Outro assunto comercial',
] as const;

export interface PropostaValores {
  nome: string;
  empresa: string;
  email: string;
  whatsapp: string;
  objetivo: string;
  mensagem: string;
  optInNewsletter: boolean;
}
export type PropostaErros = Partial<Record<keyof PropostaValores, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarProposta(v: PropostaValores): PropostaErros {
  const e: PropostaErros = {};
  const nome = v.nome.trim();
  if (nome.length < 2 || nome.length > 200) e.nome = 'Informe seu nome (2 a 200 caracteres).';
  const empresa = v.empresa.trim();
  if (empresa.length < 2 || empresa.length > 200) e.empresa = 'Informe a empresa (2 a 200 caracteres).';
  const email = v.email.trim();
  if (!EMAIL.test(email) || email.length > 320) e.email = 'Informe um e-mail válido para respondermos.';
  const whatsapp = v.whatsapp.trim();
  // Opcional; quando preenchido o contrato pede ao menos 8 caracteres. Contamos os dígitos para não aceitar só "+" ou espaços.
  if (whatsapp && (whatsapp.replace(/\D/g, '').length < 8 || whatsapp.length > 40)) e.whatsapp = 'Informe o número com DDD (ao menos 8 dígitos) ou deixe em branco.';
  if (!(OBJETIVOS as readonly string[]).includes(v.objetivo)) e.objetivo = 'Escolha o objetivo.';
  if (v.mensagem.trim().length > 4000) e.mensagem = 'A mensagem pode ter até 4.000 caracteres.';
  return e;
}

/** Corpo do POST no formato exato do contrato (`.strict()`: campo a mais é recusado). Vazios opcionais ficam de fora. */
export function corpoDaProposta(v: PropostaValores): Record<string, unknown> {
  const whatsapp = v.whatsapp.trim();
  const mensagem = v.mensagem.trim();
  return {
    nome: v.nome.trim(),
    empresa: v.empresa.trim(),
    email: v.email.trim(),
    ...(whatsapp ? { whatsapp } : {}),
    formatosInteresse: [],
    objetivo: v.objetivo,
    ...(mensagem ? { mensagem } : {}),
    optInNewsletter: v.optInNewsletter === true,
  };
}

export type EstadoProposta = 'recebido' | 'invalido' | 'muitos' | 'falha';

/** Traduz a resposta HTTP do Backend no estado da tela. 201 é o sucesso do contrato; nunca mostramos o que veio de volta. */
export function estadoDaProposta(status: number): EstadoProposta {
  if (status === 201 || status === 200 || status === 202) return 'recebido';
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'invalido';
  if (status === 429) return 'muitos';
  return 'falha';
}
