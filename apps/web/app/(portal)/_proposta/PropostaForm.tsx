'use client';

import { Button, Input } from '@ln/ui';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CONTATO_EMAIL } from '../_lib/contato';
import { corpoDaProposta, estadoDaProposta, OBJETIVOS, ROTA_PROPOSTA, validarProposta, type EstadoProposta, type PropostaErros, type PropostaValores } from './proposta';

const CHECK = { width: 24, height: 24, margin: 0, flex: 'none' } as const;

const MENSAGEM: Record<Exclude<EstadoProposta, 'recebido'>, string> = {
  invalido: 'Não conseguimos aceitar o pedido. Revise os campos e envie de novo.',
  muitos: 'Recebemos muitos pedidos desta rede em pouco tempo. Tente novamente mais tarde.',
  falha: 'Não conseguimos enviar o pedido agora. Nada foi registrado; tente de novo em instantes.',
};

/**
 * Pedido de proposta do mídia kit. Envia do navegador para a rota pública do módulo comercial (mesma origem, limite por IP do Backend).
 * Sem CAPTCHA de terceiros: honeypot `site`. Uma resposta de sucesso não devolve dado nenhum para a tela.
 */
export function PropostaForm() {
  const [erros, setErros] = useState<PropostaErros>({});
  const [estado, setEstado] = useState<'idle' | 'enviando' | EstadoProposta>('idle');
  // Pronto = hidratado: antes disso o clique faria o envio nativo (recarga, sem estado).
  const [pronto, setPronto] = useState(false);
  const id = useId();
  const avisoRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPronto(true), []);
  useEffect(() => {
    if (estado !== 'idle' && estado !== 'enviando') avisoRef.current?.focus();
  }, [estado]);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v: PropostaValores = {
      nome: String(fd.get('nome') ?? ''),
      empresa: String(fd.get('empresa') ?? ''),
      email: String(fd.get('email') ?? ''),
      whatsapp: String(fd.get('whatsapp') ?? ''),
      objetivo: String(fd.get('objetivo') ?? ''),
      mensagem: String(fd.get('mensagem') ?? ''),
      optInNewsletter: fd.get('optInNewsletter') === 'on',
    };
    const errs = validarProposta(v);
    setErros(errs);
    if (Object.keys(errs).length) {
      e.currentTarget.querySelector<HTMLElement>(`[name="${Object.keys(errs)[0]}"]`)?.focus();
      return;
    }
    // Robô que preencheu o campo escondido: responde como se tivesse recebido e não envia nada (não ensina o robô a variar).
    if (String(fd.get('site') ?? '').trim() !== '') {
      setEstado('recebido');
      return;
    }
    setEstado('enviando');
    try {
      const r = await fetch(ROTA_PROPOSTA, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(corpoDaProposta(v)),
      });
      setEstado(estadoDaProposta(r.status));
    } catch {
      setEstado('falha');
    }
  }

  if (estado === 'recebido') {
    return (
      <div className="pt-panel" role="status" tabIndex={-1} ref={avisoRef} data-testid="proposta-recebida">
        <h3 style={{ marginTop: 0 }}>Pedido recebido</h3>
        <p>O comercial do Loyalty News vai analisar o pedido e responder no e-mail informado. Por segurança, não mostramos aqui os dados enviados.</p>
      </div>
    );
  }

  const enviando = estado === 'enviando';
  const campoErro = (k: keyof PropostaValores) => (erros[k] ? <p id={`${id}-${k}-err`} className="ln-field__error"><span className="ln-sr-only">Erro: </span>{erros[k]}</p> : null);
  return (
    <form onSubmit={enviar} noValidate aria-describedby={`${id}-legenda`} data-testid="proposta-form" data-pronto={pronto ? '1' : undefined} style={{ display: 'grid', gap: 14, maxWidth: 640 }}>
      <p id={`${id}-legenda`} className="pt-meta" style={{ margin: 0 }}>Campos marcados com * são obrigatórios. Pedir uma proposta não é uma compra nem reserva de espaço.</p>
      {(estado === 'invalido' || estado === 'muitos' || estado === 'falha') && (
        <div className="pt-panel" role="alert" tabIndex={-1} ref={avisoRef} data-testid="proposta-erro">{MENSAGEM[estado]}</div>
      )}
      <Input label="Seu nome" name="nome" required autoComplete="name" minLength={2} maxLength={200} error={erros.nome} />
      <Input label="Empresa" name="empresa" required autoComplete="organization" minLength={2} maxLength={200} error={erros.empresa} />
      <Input label="E-mail comercial" name="email" type="email" required autoComplete="email" maxLength={320} error={erros.email} />
      <Input label="WhatsApp (opcional)" name="whatsapp" type="tel" autoComplete="tel" maxLength={40} hint="Com DDD. Só use se preferir ser respondido por ali." error={erros.whatsapp} />
      <div className={erros.objetivo ? 'ln-field ln-field--error' : 'ln-field'}>
        <label htmlFor={`${id}-objetivo`} className="ln-field__label">Objetivo<span aria-hidden="true"> *</span></label>
        <select id={`${id}-objetivo`} name="objetivo" className="ln-field__input" required defaultValue="" aria-invalid={erros.objetivo ? true : undefined} aria-describedby={erros.objetivo ? `${id}-objetivo-err` : undefined} style={{ minHeight: 44 }}>
          <option value="" disabled>Escolha uma opção</option>
          {OBJETIVOS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {campoErro('objetivo')}
      </div>
      <div className={erros.mensagem ? 'ln-field ln-field--error' : 'ln-field'}>
        <label htmlFor={`${id}-mensagem`} className="ln-field__label">Mensagem (opcional)</label>
        <p id={`${id}-mensagem-hint`} className="ln-field__hint">Conte o formato ou o período de interesse. Não envie dados pessoais de terceiros. Até 4.000 caracteres.</p>
        <textarea id={`${id}-mensagem`} name="mensagem" className="ln-field__input" maxLength={4000} rows={5} aria-invalid={erros.mensagem ? true : undefined} aria-describedby={[`${id}-mensagem-hint`, erros.mensagem ? `${id}-mensagem-err` : ''].filter(Boolean).join(' ')} />
        {campoErro('mensagem')}
      </div>
      {/* Honeypot: invisível e fora da ordem de tabulação; pessoas não o preenchem. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Site (deixe em branco)
          <input type="text" name="site" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <p className="pt-meta" style={{ margin: 0 }} data-testid="proposta-finalidade">
        Usaremos nome, empresa, e-mail, objetivo e, se informado, WhatsApp e mensagem para responder ao pedido de proposta ou de mídia kit e conduzir a negociação. Gravamos a data e a hora do envio como registro do pedido. Se você marcar a opção abaixo, registramos o interesse na newsletter; nada é enviado hoje. Detalhes na{' '}
        <Link href="/privacidade" style={{ textDecoration: 'underline' }}>política de privacidade</Link>.
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
        <input type="checkbox" name="optInNewsletter" style={CHECK} defaultChecked={false} /> Tenho interesse na newsletter do Loyalty News (opcional, separado do pedido)
      </label>
      <div>
        <Button type="submit" variant="primary" disabled={enviando || !pronto} aria-busy={enviando || undefined}>{enviando ? 'Enviando…' : 'Pedir proposta'}</Button>
      </div>
      <p className="pt-meta" style={{ margin: 0 }}>Prefere e-mail? Escreva para <a href={`mailto:${CONTATO_EMAIL}`} style={{ textDecoration: 'underline' }}>{CONTATO_EMAIL}</a>.</p>
    </form>
  );
}
