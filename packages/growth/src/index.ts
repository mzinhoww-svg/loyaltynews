export * from './types';
export * from './flags';
export * from './mlabs/port';
export * from './mlabs/live';
export * from './mlabs/errors';
export * from './copy/engine';
export * from './creative/post';
export * from './publisher/publisher';
export * from './package/linkedin';
export * from './package/instagram';
// Adaptadores (simulado e real), a capability de escrita e `bindWriteAuthority` são INTERNOS: só `createSocialPublisher`
// os cria e os mantém. Não reexporte nada de mlabs/*.internal nem de mlabs/simulated.mock (teste public-surface.test.ts).
export * from './mlabs/validate';
