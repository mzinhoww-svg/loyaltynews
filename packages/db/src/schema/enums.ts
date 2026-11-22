import { pgEnum } from 'drizzle-orm/pg-core';

/** Estado por formato (CP-12): nada à venda sem capacidade operacional. */
export const disponibilidade = pgEnum('disponibilidade', ['disponivel', 'sob_consulta', 'indisponivel']);
