import { describe, expect, it } from 'vitest';
import { AccessDeniedError, getSession, requireRole } from './index';

describe('auth (stub)', () => {
  it('não há sessão por padrão', async () => {
    expect(await getSession()).toBeNull();
  });
  it('requireRole nega por padrão', async () => {
    await expect(requireRole(['admin'])).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
