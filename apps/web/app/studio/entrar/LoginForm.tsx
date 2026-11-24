'use client';

// Login do LN Studio: e-mail e senha, depois o código do aplicativo autenticador (ou um código de recuperação), pelo /api/auth
// existente (Better Auth + 2º fator, ADR-011). Regras desta tela:
//  - nenhuma credencial vai para URL, query, localStorage, sessionStorage ou console; a sessão fica só no cookie do Better Auth;
//  - a senha não é guardada em estado do React (lida do campo no envio e apagada do campo ao passar para o código);
//  - erro do 1º passo é genérico (não diz se o e-mail existe); 429 mostra o tempo de espera;
//  - sem 2º fator ativo o acesso é negado: a sessão aberta só com senha é encerrada na hora (ADR-011).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { destinoSeguro, erroDeCodigo, erroDeEntrada, limparCodigo, limparRecuperacao, type RespostaAuth } from '@/lib/studio/login';

type Etapa = 'credenciais' | 'codigo' | 'recuperacao';

interface Retorno {
  auth: RespostaAuth;
  corpo: Record<string, unknown> | null;
}

/** POST JSON no /api/auth. Nunca lança: falha de rede vira status 0. Nada do corpo enviado é registrado. */
async function postar(caminho: string, corpo: Record<string, unknown>): Promise<Retorno> {
  try {
    const res = await fetch(`/api/auth${caminho}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const code = typeof json?.code === 'string' ? json.code : typeof (json?.error as { code?: unknown } | undefined)?.code === 'string' ? ((json!.error as { code: string }).code) : undefined;
    return { auth: { status: res.status, ...(code ? { code } : {}), retryAfter: res.headers.get('retry-after') ?? res.headers.get('x-retry-after') }, corpo: json };
  } catch {
    return { auth: { status: 0 }, corpo: null };
  }
}

const SEM_2FA = 'Sua conta não tem a verificação em duas etapas ativa. Por segurança, o acesso ao Studio foi negado. Peça a um administrador para ativá-la.';

export function LoginForm({ retorno }: { retorno?: string }) {
  const destino = destinoSeguro(retorno);
  const [etapa, setEtapa] = useState<Etapa>('credenciais');
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);
  const senhaRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codigoRef = useRef<HTMLInputElement>(null);
  const recuperacaoRef = useRef<HTMLInputElement>(null);

  // o botão só vale depois da hidratação: sem isso, um envio nativo antes do JavaScript carregar não leva credencial para lugar nenhum
  useEffect(() => setPronto(true), []);
  useEffect(() => {
    if (etapa === 'codigo') codigoRef.current?.focus();
    else if (etapa === 'recuperacao') recuperacaoRef.current?.focus();
    else emailRef.current?.focus();
  }, [etapa]);

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    const mail = emailRef.current?.value.trim() ?? '';
    const senha = senhaRef.current?.value ?? '';
    if (!mail || !senha) {
      setErro('Informe o e-mail e a senha.');
      return;
    }
    setErro(null);
    setEnviando(true);
    const r = await postar('/sign-in/email', { email: mail, password: senha });
    if (r.auth.status === 200 && r.corpo?.twoFactorRedirect === true) {
      setEmail(mail);
      if (senhaRef.current) senhaRef.current.value = '';
      setEtapa('codigo');
    } else if (r.auth.status === 200) {
      // entrou só com a senha: sem 2º fator o Studio nega o acesso; encerra a sessão aberta agora
      await postar('/sign-out', {});
      if (senhaRef.current) senhaRef.current.value = '';
      setErro(SEM_2FA);
    } else {
      if (senhaRef.current) senhaRef.current.value = '';
      setErro(erroDeEntrada(r.auth));
    }
    setEnviando(false);
  }

  async function verificar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    const recuperacao = etapa === 'recuperacao';
    const campo = recuperacao ? recuperacaoRef.current : codigoRef.current;
    const code = recuperacao ? limparRecuperacao(campo?.value ?? '') : limparCodigo(campo?.value ?? '');
    if (recuperacao ? code.length < 6 : code.length !== 6) {
      setErro(recuperacao ? 'Informe o código de recuperação.' : 'Informe o código de 6 dígitos do aplicativo autenticador.');
      return;
    }
    setErro(null);
    setEnviando(true);
    const r = await postar(recuperacao ? '/two-factor/verify-backup-code' : '/two-factor/verify-totp', { code });
    if (r.auth.status === 200) {
      // recarga completa: o servidor lê o cookie de sessão novo e o Studio abre já autenticado
      window.location.assign(destino);
      return;
    }
    const m = erroDeCodigo(r.auth, recuperacao);
    if (campo) campo.value = '';
    setErro(m.texto);
    if (m.reiniciar) setEtapa('credenciais');
    setEnviando(false);
  }

  const alerta = erro ? (
    <div className="st-alert err" role="alert" id="login-erro" data-login-erro>
      {erro}
    </div>
  ) : null;

  return (
    <div data-login data-etapa={etapa}>
      <noscript>
        <p className="st-alert err">Ative o JavaScript do navegador para entrar no Studio.</p>
      </noscript>
      {etapa === 'credenciais' ? (
        <form onSubmit={entrar} method="post" aria-label="Entrar" noValidate>
          {alerta}
          <div className="st-field">
            <label htmlFor="login-email">E-mail</label>
            <input id="login-email" ref={emailRef} name="username" type="email" inputMode="email" autoComplete="username" defaultValue={email} required autoCapitalize="none" spellCheck={false} aria-describedby={erro ? 'login-erro' : undefined} />
          </div>
          <div className="st-field">
            <label htmlFor="login-senha">Senha</label>
            <input id="login-senha" ref={senhaRef} name="password" type="password" autoComplete="current-password" required aria-describedby={erro ? 'login-erro' : undefined} />
          </div>
          <button className="st-btn" type="submit" disabled={!pronto || enviando} aria-busy={enviando}>
            {enviando ? 'Entrando…' : 'Continuar'}
          </button>
        </form>
      ) : (
        <form onSubmit={verificar} method="post" aria-label={etapa === 'codigo' ? 'Verificação em duas etapas' : 'Recuperação de acesso'} noValidate>
          <p className="st-hint">
            {etapa === 'codigo' ? 'Digite o código de 6 dígitos que o aplicativo autenticador mostra agora.' : 'Digite um dos códigos de recuperação que você guardou. Cada código vale uma vez.'}
          </p>
          {alerta}
          {etapa === 'codigo' ? (
            <div className="st-field">
              <label htmlFor="login-codigo">Código do aplicativo autenticador</label>
              <input id="login-codigo" ref={codigoRef} name="code" type="text" inputMode="numeric" pattern="[0-9 ]*" autoComplete="one-time-code" maxLength={7} required aria-describedby={erro ? 'login-erro' : undefined} />
            </div>
          ) : (
            <div className="st-field">
              <label htmlFor="login-recuperacao">Código de recuperação</label>
              <input id="login-recuperacao" ref={recuperacaoRef} name="backup-code" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} required aria-describedby={erro ? 'login-erro' : undefined} />
            </div>
          )}
          <div className="st-actions">
            <button className="st-btn" type="submit" disabled={!pronto || enviando} aria-busy={enviando}>
              {enviando ? 'Verificando…' : 'Entrar'}
            </button>
            <button
              className="st-btn sec"
              type="button"
              onClick={() => {
                setErro(null);
                setEtapa(etapa === 'codigo' ? 'recuperacao' : 'codigo');
              }}
            >
              {etapa === 'codigo' ? 'Usar código de recuperação' : 'Usar o aplicativo autenticador'}
            </button>
            <button
              className="st-btn sec"
              type="button"
              onClick={() => {
                setErro(null);
                setEtapa('credenciais');
              }}
            >
              Voltar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
