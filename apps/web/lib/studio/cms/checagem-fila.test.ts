import { describe, expect, it } from 'vitest';
import { AVISO_CHECAGEM_DESLIGADA, estadoDaFilaDeChecagem, resultadoDoRecheck } from './checagem-fila';

// A decisão da fila (ADR-002) governa a tela: `on` mostra o botão; `off` mostra aviso e nenhum botão.
describe('estadoDaFilaDeChecagem', () => {
  it('fila on: o pedido é aceito e não há aviso (botão aparece)', () => {
    expect(estadoDaFilaDeChecagem({ mode: 'on' })).toEqual({ pedidoAceito: true, aviso: null });
  });

  it('fila off: o pedido não é aceito e a tela mostra o aviso estático', () => {
    expect(estadoDaFilaDeChecagem({ mode: 'off' })).toEqual({ pedidoAceito: false, aviso: AVISO_CHECAGEM_DESLIGADA });
  });

  it('decisão ausente (fila sem decisão) também não libera o botão', () => {
    expect(estadoDaFilaDeChecagem(undefined).pedidoAceito).toBe(false);
  });
});

// A recusa é reconhecida pelo CÓDIGO: 503 hoje, 501 amanhã, mesmo resultado.
describe('resultadoDoRecheck', () => {
  const envelope = { error: { code: 'QUEUE_DISABLED', message: 'A etapa "checagem" está desligada nesta versão; o pedido não foi aceito.' } };

  it('QUEUE_DISABLED com 503: erro com a mensagem do Backend, nunca "enfileirada"', () => {
    expect(resultadoDoRecheck({ status: 503, body: envelope }, envelope.error.message)).toEqual({ tipo: 'err', aviso: envelope.error.message });
  });

  it('QUEUE_DISABLED com 501 (novo status): o mesmo resultado', () => {
    expect(resultadoDoRecheck({ status: 501, body: envelope }, envelope.error.message)).toEqual({ tipo: 'err', aviso: envelope.error.message });
  });

  it('o código vence o status: envelope QUEUE_DISABLED com status de sucesso ainda é erro', () => {
    expect(resultadoDoRecheck({ status: 200, body: envelope }, envelope.error.message).tipo).toBe('err');
  });

  it('outro erro segue como erro com a mensagem recebida', () => {
    expect(resultadoDoRecheck({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'Sem permissão.' } } }, 'Sem permissão.')).toEqual({ tipo: 'err', aviso: 'Sem permissão.' });
  });

  it('sucesso: a única mensagem que fala em enfileirar', () => {
    expect(resultadoDoRecheck({ status: 200, body: { jobId: 'x' } }, '')).toEqual({ tipo: 'ok', aviso: 'Nova checagem enfileirada.' });
  });
});
