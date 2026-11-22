// Registro dos handlers de fila. Cada frente dona de uma fila registra o seu aqui (ou importa de seu pacote).
// Vazio de propósito: nenhuma fila é "processada" por um handler de mentira. Fila sem handler não tem worker.
import type { Handlers } from './runtime';

export const handlers: Handlers = {};
