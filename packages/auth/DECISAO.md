# packages/auth — escolha (ADR-011, spike resumido)

**Escolha: Better Auth** (MIT, v1.7.27, publicada em 2026-11-20). Auth.js (`next-auth` 5.0.0-beta.32, ISC) fica em beta e o provedor de credenciais força sessão JWT, não revogável no servidor, e não traz MFA; exigiria implementar à mão o que os requisitos fixos pedem.

| Critério (peso proposto na ADR) | Better Auth | Auth.js v5 beta | Própria (argon2id + TOTP) |
|---|---|---|---|
| Segurança 40 | sessão em banco (revogável), plugin `twoFactor` TOTP, limite de tentativas nativo, `disableSignUp` | sessão JWT com credenciais; sem MFA nativo | controle total, superfície de erro nossa |
| Manutenção/licença 25 | MIT, release na semana | beta desde antes de jul/2026, ISC | manutenção nossa |
| Esforço 20 | baixo (adaptador de banco) | médio-alto (MFA + revogação à mão) | alto |
| Dependências 15 | 1 pacote + adaptador | 1 pacote + adaptador | 2-3 pacotes |

Pontuação numérica não calculada: o spike completo (R2-03) não rodou. Isto é decisão de fast-track sobre evidência de metadados do registro npm, não aceite da ADR-011.
**Não verificado:** comportamento real do plugin `twoFactor` e do limitador com o banco do projeto (testes virão após o scaffold); licenças das dependências transitivas.
