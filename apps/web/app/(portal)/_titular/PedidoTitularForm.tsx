'use client';

import { Button, Input } from '@ln/ui';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  dataDoPrazo, estadoDaResposta, PRAZO_DIAS_RESPOSTA, reciboDaResposta, ROTA_PEDIDO, urlDoAlvo, validarPedido,
  type EstadoEnvio, type PedidoErros, type PedidoValores, type ReciboPedido,
} from './pedido';

/** Botão de rádio com 24px (WCAG 2.5.8); a linha inteira (label, 44px) é a área de toque. Revisão visual int/012, P2-4. */
const RADIO = { width: 24, height: 24, margin: 0, flex: 'none' } as const;

const MENSAGEM: Record<Exclude<EstadoEnvio, 'recebido'>, string> = {
  invalido: 'Não conseguimos aceitar o pedido. Revise os campos e envie de novo.',
  muitos: 'Recebemos muitos pedidos deste contato ou desta rede em pouco tempo. Tente novamente mais tarde.',
  falha: 'Não conseguimos enviar o pedido agora. Nada foi registrado; tente de novo em instantes.',
};

/**
 * Formulário público de correção ou remoção (DP-38). Envia direto do navegador para a rota pública, na mesma origem, para o
 * limite por IP do Backend valer por leitor. Sem CAPTCHA de terceiros: honeypot `site` (campo escondido de pessoas).
 */
export function PedidoTitularForm() {
  const [erros, setErros] = useState<PedidoErros>({});
  const [estado, setEstado] = useState<'idle' | 'enviando' | EstadoEnvio>('idle');
  const [recibo, setRecibo] = useState<ReciboPedido | null>(null);
  const [urlInicial, setUrlInicial] = useState('');
  // Pronto = hidratado: antes disso o clique faria o envio nativo do formulário (recarga, sem estado). O botão só habilita aqui.
  const [pronto, setPronto] = useState(false);
  const textoId = useId();
  const tipoId = useId();
  const avisoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUrlInicial(urlDoAlvo(new URLSearchParams(window.location.search).get('alvo'), window.location.origin));
    setPronto(true);
  }, []);

  useEffect(() => {
    if (estado !== 'idle' && estado !== 'enviando') avisoRef.current?.focus();
  }, [estado]);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v: PedidoValores = {
      nome: String(fd.get('nome') ?? ''),
      contato: String(fd.get('contato') ?? ''),
      url: String(fd.get('url') ?? ''),
      tipo: String(fd.get('tipo') ?? ''),
      texto: String(fd.get('texto') ?? ''),
    };
    const errs = validarPedido(v);
    setErros(errs);
    if (Object.keys(errs).length) {
      // Leva o foco ao primeiro campo com erro (a mensagem está ligada a ele por aria-describedby).
      e.currentTarget.querySelector<HTMLElement>(`[name="${Object.keys(errs)[0]}"]`)?.focus();
      return;
    }
    setEstado('enviando');
    try {
      const r = await fetch(ROTA_PEDIDO, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ ...v, nome: v.nome.trim(), contato: v.contato.trim(), url: v.url.trim(), texto: v.texto.trim(), site: String(fd.get('site') ?? '') }),
      });
      const j = await r.json().catch(() => null);
      const st = estadoDaResposta(r.status);
      if (st === 'recebido') setRecibo(reciboDaResposta(j));
      setEstado(st);
    } catch {
      setEstado('falha');
    }
  }

  if (estado === 'recebido') {
    return (
      <div className="pt-panel" role="status" tabIndex={-1} ref={avisoRef} data-testid="pedido-recebido">
        <h3 style={{ marginTop: 0 }}>Pedido recebido</h3>
        <p>Seu pedido entrou na fila da redação e será analisado por uma pessoa.</p>
        {recibo ? (
          <>
            <p>
              Protocolo: <strong data-testid="pedido-protocolo">{recibo.protocolo}</strong>
            </p>
            <p>
              Prazo de resposta: até {recibo.prazoDias} dias corridos, ou seja, até {dataDoPrazo(recibo.prazoEm)}. Guarde o protocolo: ele
              identifica o pedido no contato com a redação.
            </p>
          </>
        ) : (
          <p>Responderemos no e-mail informado.</p>
        )}
        <p>Por segurança, não mostramos aqui os dados enviados.</p>
      </div>
    );
  }

  const enviando = estado === 'enviando';
  return (
    <form onSubmit={enviar} noValidate aria-describedby={`${textoId}-legenda`} data-testid="pedido-form" data-pronto={pronto ? '1' : undefined} style={{ display: 'grid', gap: 14, maxWidth: 640 }}>
      <p id={`${textoId}-legenda`} className="pt-meta" style={{ margin: 0 }}>Todos os campos marcados com * são obrigatórios.</p>
      <div className="pt-panel" data-testid="pedido-escopo" style={{ display: 'grid', gap: 8 }}>
        <p style={{ margin: 0 }}>
          <strong>O que este canal cobre:</strong> correção ou remoção de dados pessoais exibidos nas páginas do portal.{' '}
          <strong>Não cobre</strong> acesso, confirmação de tratamento, portabilidade, eliminação de dados fora do portal, revogação de
          consentimento nem descadastro da newsletter; para esses direitos, escreva para contato@loyaltynews.com.br, como indica a página de{' '}
          <Link href="/privacidade">Privacidade e LGPD</Link>.
        </p>
        <p className="pt-meta" data-testid="pedido-prazo" style={{ margin: 0 }}>
          Prazo de resposta: até {PRAZO_DIAS_RESPOSTA} dias corridos. Você recebe um protocolo para acompanhar.
        </p>
      </div>
      {(estado === 'invalido' || estado === 'muitos' || estado === 'falha') && (
        <div className="pt-panel" role="alert" tabIndex={-1} ref={avisoRef} data-testid="pedido-erro">
          {MENSAGEM[estado]}
        </div>
      )}
      <Input label="Seu nome" name="nome" required autoComplete="name" minLength={2} maxLength={200} error={erros.nome} />
      <Input label="E-mail para resposta" name="contato" type="email" required autoComplete="email" maxLength={320} error={erros.contato} />
      <Input
        key={urlInicial}
        label="Endereço da página"
        name="url"
        type="url"
        required
        maxLength={2048}
        defaultValue={urlInicial}
        hint="Cole o link da página do Loyalty News com o dado a corrigir ou remover."
        error={erros.url}
      />
      <fieldset className={erros.tipo ? 'ln-field ln-field--error' : 'ln-field'} aria-describedby={erros.tipo ? `${tipoId}-err` : undefined} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ln-field__label">O que você pede?<span aria-hidden="true"> *</span></legend>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
          <input type="radio" name="tipo" value="correcao" style={RADIO} defaultChecked /> Correção de um dado
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
          <input type="radio" name="tipo" value="remocao" style={RADIO} /> Remoção de um dado
        </label>
        {erros.tipo && <p id={`${tipoId}-err`} className="ln-field__error"><span className="ln-sr-only">Erro: </span>{erros.tipo}</p>}
      </fieldset>
      <div className={erros.texto ? 'ln-field ln-field--error' : 'ln-field'}>
        <label htmlFor={textoId} className="ln-field__label">Descreva o pedido<span aria-hidden="true"> *</span></label>
        <p id={`${textoId}-hint`} className="ln-field__hint">Diga o que está errado ou o que deve sair e, se puder, a informação correta. Até 5.000 caracteres.</p>
        <textarea
          id={textoId}
          name="texto"
          className="ln-field__input"
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          aria-invalid={erros.texto ? true : undefined}
          aria-describedby={[`${textoId}-hint`, erros.texto ? `${textoId}-err` : ''].filter(Boolean).join(' ')}
        />
        {erros.texto && <p id={`${textoId}-err`} className="ln-field__error"><span className="ln-sr-only">Erro: </span>{erros.texto}</p>}
      </div>
      {/* Honeypot: invisível e fora da ordem de tabulação; pessoas não o preenchem. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Site (deixe em branco)
          <input type="text" name="site" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={enviando || !pronto} aria-busy={enviando || undefined}>
          {enviando ? 'Enviando…' : 'Enviar pedido'}
        </Button>
      </div>
      <p className="pt-meta" style={{ margin: 0 }}>
        Usamos seu nome e e-mail só para analisar e responder este pedido.
      </p>
    </form>
  );
}
