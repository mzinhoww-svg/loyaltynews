'use client';

// Formulário de troca da própria senha. Regras desta tela (as mesmas da entrada):
//  - nenhuma senha vai para URL, query, localStorage, sessionStorage ou console; as senhas não ficam em estado do React
//    (lidas dos campos no envio) e os campos são limpos depois de cada resposta;
//  - a validação aqui é só ajuda; quem decide é o servidor (POST /api/studio/conta/senha → changeOwnPassword).
import { useEffect, useRef, useState, type FormEvent } from 'react';

type Aviso = { tipo: 'ok' | 'err'; texto: string } | null;
type Resposta = { mensagem?: string; error?: { message?: string } };

const MIN = 12;

export function TrocarSenhaForm() {
  const atualRef = useRef<HTMLInputElement>(null);
  const novaRef = useRef<HTMLInputElement>(null);
  const confRef = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);
  useEffect(() => setPronto(true), []);

  const limpar = () => {
    for (const r of [atualRef, novaRef, confRef]) if (r.current) r.current.value = '';
  };

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    const senhaAtual = atualRef.current?.value ?? '';
    const novaSenha = novaRef.current?.value ?? '';
    const confirmacao = confRef.current?.value ?? '';
    const erros: string[] = [];
    if (!senhaAtual) erros.push('Informe a senha atual.');
    if (novaSenha.length < MIN) erros.push(`A nova senha precisa ter pelo menos ${MIN} caracteres.`);
    if (novaSenha !== confirmacao) erros.push('A confirmação não é igual à nova senha.');
    if (senhaAtual && senhaAtual === novaSenha) erros.push('A nova senha precisa ser diferente da atual.');
    if (erros.length) {
      setAviso({ tipo: 'err', texto: erros.join(' ') });
      return;
    }
    setAviso(null);
    setEnviando(true);
    let status = 0;
    let json = null as Resposta | null;
    try {
      const res = await fetch('/api/studio/conta/senha', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ senhaAtual, novaSenha, confirmacao }),
      });
      status = res.status;
      json = (await res.json().catch(() => null)) as Resposta | null;
    } catch {
      // falha de rede: status fica 0
    }
    limpar();
    setEnviando(false);
    if (status === 200) {
      setAviso({ tipo: 'ok', texto: json?.mensagem ?? 'Senha trocada.' });
      return;
    }
    if (status === 401) {
      window.location.assign('/studio/entrar?motivo=NO_SESSION');
      return;
    }
    const texto = status === 0 ? 'Sem conexão com o servidor. Tente de novo.' : (json?.error?.message ?? 'Não foi possível trocar a senha agora. Tente de novo.');
    setAviso({ tipo: 'err', texto });
    atualRef.current?.focus();
  }

  return (
    <form onSubmit={enviar} method="post" aria-label="Trocar senha" noValidate data-trocar-senha>
      {aviso ? (
        <div className={`st-alert ${aviso.tipo}`} role={aviso.tipo === 'err' ? 'alert' : 'status'} id="senha-aviso" data-senha-aviso={aviso.tipo}>
          {aviso.texto}
        </div>
      ) : null}
      <div className="st-field">
        <label htmlFor="senha-atual">Senha atual</label>
        <input id="senha-atual" ref={atualRef} name="current-password" type="password" autoComplete="current-password" required aria-describedby={aviso?.tipo === 'err' ? 'senha-aviso' : undefined} />
      </div>
      <div className="st-field">
        <label htmlFor="senha-nova">Nova senha</label>
        <input id="senha-nova" ref={novaRef} name="new-password" type="password" autoComplete="new-password" minLength={MIN} maxLength={128} required aria-describedby="senha-regra" />
        <p className="st-hint" id="senha-regra">
          Pelo menos 12 caracteres, diferente da atual.
        </p>
      </div>
      <div className="st-field">
        <label htmlFor="senha-confirmacao">Confirme a nova senha</label>
        <input id="senha-confirmacao" ref={confRef} name="confirm-password" type="password" autoComplete="new-password" maxLength={128} required />
      </div>
      <button className="st-btn" type="submit" disabled={!pronto || enviando} aria-busy={enviando}>
        {enviando ? 'Trocando…' : 'Trocar senha'}
      </button>
    </form>
  );
}
