"""R0-06 caso 3: mudanca do executor no verificador e barrada (LN Verifier Ops).

Demonstra, com o codigo do proprio verificador (scripts/premerge.py root_signed +
keys/raiz.asc + rulesets/verifier-main.json do commit a2bfc48):
  - o commit real da main do verificador (a2bfc48) e assinado pela RAIZ;
  - um commit de mudanca assinado por chave que nao e a raiz NAO passa no mesmo teste.

Preparo (sem caminho pessoal): clone do repo do verificador no commit a2bfc48 em
  <tempdir>/ln-r006/verifier-a2bfc48
e o GnuPG em <GPG_BIN> (padrao "C:\\Program Files\\GnuPG\\bin" no Windows, "/usr/bin" fora).
O script so usa a chave PUBLICA da raiz (keys/raiz.asc) e gera uma chave descartavel
"executor@test.invalid" no chaveiro temporario; nao assina nada com a raiz.
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile

BASE = pathlib.Path(tempfile.gettempdir()) / "ln-r006"
VER = BASE / "verifier-a2bfc48"
GPGBIN = pathlib.Path(os.environ.get("GPG_BIN", r"C:\Program Files\GnuPG\bin"))
HOME_ROOT = BASE / "gnupg-root"
HOME_FAKE = BASE / "gnupg-fake"
ROOT_FPR = "1D4A3E263898E5B0C0590FD7A2A2BB73C4C84309"
ENV = {
    **os.environ,
    "PATH": str(GPGBIN) + os.pathsep + os.environ["PATH"],
    "MSYS2_ENV_CONV_EXCL": "GNUPGHOME",
    "GIT_CONFIG_COUNT": "1",
    "GIT_CONFIG_KEY_0": "gpg.program",
    "GIT_CONFIG_VALUE_0": str(GPGBIN / "gpg.exe"),
}
res = {"commit": "a2bfc48da99a6ef249d2e1ef5248bfbdf7fbebd8", "casos": {}}
# o root_signed monta o env a partir de os.environ: propaga a config do gpg nativo
os.environ.update({k: ENV[k] for k in ("PATH", "MSYS2_ENV_CONV_EXCL", "GIT_CONFIG_COUNT",
                                       "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0")})


def run(cmd, cwd=None, env=None, check=True):
    p = subprocess.run([str(c) for c in cmd], cwd=cwd, capture_output=True, env=env or ENV)
    if check and p.returncode:
        raise SystemExit("falhou: %s\n%s" % (" ".join(map(str, cmd)), p.stderr.decode(errors="replace")[:400]))
    return p


# chaveiro so com a chave publica da raiz
HOME_ROOT.mkdir(parents=True, exist_ok=True)
run(["gpg", "--batch", "--quiet", "--homedir", HOME_ROOT, "--import", VER / "keys" / "raiz.asc"],
    env={**ENV, "GNUPGHOME": str(HOME_ROOT)})
# chave falsa de "executor"
HOME_FAKE.mkdir(parents=True, exist_ok=True)
existe = run(["gpg", "--batch", "--with-colons", "--list-keys", "executor@test.invalid"],
             env={**ENV, "GNUPGHOME": str(HOME_FAKE)}, check=False).returncode == 0
if not existe:
    run(["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase", "", "--quick-generate-key",
         "executor <executor@test.invalid>", "ed25519", "sign", "0"], env={**ENV, "GNUPGHOME": str(HOME_FAKE)})
cols = run(["gpg", "--batch", "--with-colons", "--list-keys", "executor@test.invalid"],
           env={**ENV, "GNUPGHOME": str(HOME_FAKE)}).stdout.decode()
fake_fpr = next(l.split(":")[9] for l in cols.splitlines() if l.startswith("fpr:"))

# codigo do verificador
sys.path.insert(0, str(VER / "scripts"))
from premerge import root_signed  # noqa: E402

# 1) commit real da main
res["casos"]["main_a2bfc48"] = {
    "assinado_pela_raiz": root_signed(VER, "a2bfc48", ROOT_FPR, str(HOME_ROOT)),
}

# 2) commit de mudanca assinado por outra chave, sobre a2bfc48
chg = BASE / ("verifier-mudanca-executor-" + str(os.getpid()))
run(["git", "clone", "-q", "--no-hardlinks", str(VER), str(chg)])
run(["git", "-C", chg, "checkout", "-q", "--detach", "a2bfc48"])
(chg / "README.md").write_text((chg / "README.md").read_text(encoding="utf-8") + "\nmudanca do executor\n", encoding="utf-8")
run(["git", "-C", chg, "add", "README.md"])
run(["git", "-C", chg, "-c", "user.name=Executor", "-c", "user.email=executor@test.invalid",
     "commit", "-q", "-S" + fake_fpr, "-m", "mudanca do executor no verificador"],
    env={**ENV, "GNUPGHOME": str(HOME_FAKE)})
sha = run(["git", "-C", chg, "rev-parse", "HEAD"]).stdout.decode().strip()
res["casos"]["commit_do_executor"] = {
    "sha": sha,
    "fingerprint_do_autor": fake_fpr,
    "assinado_pela_raiz": root_signed(chg, sha, ROOT_FPR, str(HOME_ROOT)),
}

# 3) o ruleset aplicado ao main do verificador
rs = json.loads(subprocess.run(["git", "-C", str(VER), "show", "a2bfc48:rulesets/verifier-main.json"],
                               capture_output=True).stdout)
res["casos"]["ruleset_verifier_main"] = {
    "enforcement": rs.get("enforcement"),
    "bypass_actors": rs.get("bypass_actors"),
    "regras": [r.get("type") for r in rs.get("rules", [])],
    "refs": (rs.get("conditions") or {}).get("ref_name"),
}
res["ok"] = (res["casos"]["main_a2bfc48"]["assinado_pela_raiz"] is True
             and res["casos"]["commit_do_executor"]["assinado_pela_raiz"] is False
             and res["casos"]["ruleset_verifier_main"]["bypass_actors"] == [])
(BASE / "caso3-resultado.json").write_text(json.dumps(res, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(res, ensure_ascii=False, indent=2))
