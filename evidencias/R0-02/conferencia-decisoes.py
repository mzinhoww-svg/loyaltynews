"""Teste R0-02-TEST: cada decisao do responsavel de 21/11/2026 esta registrada.

Le, somente, os arquivos versionados no commit corrente:
  audit-output/12_RESPOSTA_OFICIAL.md  secao "2. Decisoes"
  audit-output/11_CONCILIACAO.md       secao "1. Decisoes recebidas"
  governance/decisions.yaml            registro (JSON)
  evidencias/R0-02/registro-R0-02.md   registro legivel com o mapa hora -> D

Prova: as 13 linhas de cada documento tem uma entrada D01..D13 com status
"registrada", escolha nao vazia e referencia a 12_RESPOSTA_OFICIAL; a divisao
7 x 19:20 e 6 x 22:56 confere nos dois documentos; as 16 divergencias V21-*
estao como "proposta" e apontam um arquivo existente; nenhuma entrada tem
campo de aceite; o mapa do registro legivel cobre os 13 itens.

LIMITE: prova estrutura e presenca, nao fidelidade semantica integral.
Uso: python -X utf8 evidencias/R0-02/conferencia-decisoes.py
"""
import hashlib
import io
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]


def read(rel):
    return io.open(ROOT / rel, encoding="utf-8").read()


def section(text, head):
    m = re.search(r"^## " + re.escape(head) + r".*?$(.*?)(?=^## |\Z)", text, re.S | re.M)
    return m.group(1) if m else ""


def rows12(text):
    body = section(text, "2. Decis")
    return {int(m.group(1)): m.group(2).strip()
            for m in re.finditer(r"^\| (\d{1,2}) \| ([^|]+) \|", body, re.M)}


def rows11(text):
    body = section(text, "1. Decis")
    return {int(m.group(1)): (m.group(2), m.group(3).strip())
            for m in re.finditer(r"^\| (\d{1,2}) \| (\d\d:\d\d) \| ([^|]+) \|", body, re.M)}


fail = []

try:
    dec_raw = (ROOT / "governance/decisions.yaml").read_bytes()
    dec = json.loads(dec_raw)
    r12 = read("audit-output/12_RESPOSTA_OFICIAL.md")
    r11 = read("audit-output/11_CONCILIACAO.md")
    reg = read("evidencias/R0-02/registro-R0-02.md")
except Exception as ex:  # arquivo ausente ou ilegivel
    print(json.dumps({"ok": False, "falhas": ["leitura: %s" % ex]}, ensure_ascii=False, indent=1))
    sys.exit(1)

d12 = rows12(r12)
d11 = rows11(r11)
if sorted(d12) != list(range(1, 14)):
    fail.append("12 §2: linhas lidas %s" % sorted(d12))
if sorted(d11) != list(range(1, 14)):
    fail.append("11 §1: linhas lidas %s" % sorted(d11))
if set(d12) != set(d11):
    fail.append("12 §2 e 11 §1 com conjuntos de linhas diferentes")

split_ok = bool(re.search(
    r"As sete primeiras s[ãa]o das 19:20; as seis [úu]ltimas, das 22:56", r12))
if not split_ok:
    fail.append("12 §2 nao declara a divisao 7 x 19:20 / 6 x 22:56")

by = {d["id"]: d for d in dec}
ids = [d["id"] for d in dec]
if len(ids) != len(set(ids)):
    fail.append("IDs duplicados em decisions.yaml")
if not re.fullmatch(r"[0-9a-f]{64}", hashlib.sha256(dec_raw).hexdigest()):
    fail.append("hash de decisions.yaml invalido")

mapa = []
for n in range(1, 14):
    k = "D%02d" % n
    hora, texto11 = d11.get(n, ("", ""))
    esperada = "19:20" if n <= 7 else "22:56"
    if hora != esperada:
        fail.append("%s: hora em 11 §1 = %r, esperada %s" % (k, hora, esperada))
    e = by.get(k)
    if not e:
        fail.append("%s ausente de decisions.yaml" % k)
        continue
    if e.get("status") != "registrada":
        fail.append("%s: status %r != registrada" % (k, e.get("status")))
    if not e.get("escolha", "").strip():
        fail.append("%s: escolha vazia" % k)
    if "12_RESPOSTA_OFICIAL" not in e.get("referencia", ""):
        fail.append("%s: referencia sem 12_RESPOSTA_OFICIAL" % k)
    if not re.search(r"^\| %d \| %s \| %s \|" % (n, re.escape(hora), k), reg, re.M):
        fail.append("%s: sem linha no registro legivel" % k)
    mapa.append({"n": n, "hora": hora, "id": k,
                 "decisao_11": texto11,
                 "decisao_12": d12.get(n, ""),
                 "escolha": e.get("escolha", "")})

v21_fora_do_repo = []
for n in range(1, 17):
    k = "V21-%02d" % n
    e = by.get(k)
    if not e:
        fail.append("%s ausente" % k)
        continue
    if e.get("status") != "proposta":
        fail.append("%s: status %r != proposta" % (k, e.get("status")))
    ref = e.get("referencia", "")
    if not ref:
        fail.append("%s: referencia vazia" % k)
    elif not (ROOT / ref).exists():
        # V21-16 aponta um arquivo do registro compartilhado, fora do repositorio.
        v21_fora_do_repo.append({"id": k, "referencia": ref})

campos_aceite = {"approved_by", "approved_at", "accepted", "accepted_by", "aceito", "aceite"}
for d in dec:
    if campos_aceite & set(d):
        fail.append("%s tem campo de aceite" % d.get("id"))

saida = {
    "teste": "R0-02-TEST",
    "ok": not fail,
    "decisions_sha256": hashlib.sha256(dec_raw).hexdigest(),
    "entradas": len(dec),
    "decisoes_12": len(d12),
    "decisoes_11": len(d11),
    "divisao": {"19:20": 7, "22:56": 6},
    "mapa": mapa,
    "v21_propostas": len([d for d in dec if d["id"].startswith("V21-")]),
    "v21_referencia_fora_do_repo": v21_fora_do_repo,
    "falhas": fail,
    "limite": "estrutura e presenca; nao prova fidelidade semantica integral",
}
print(json.dumps(saida, ensure_ascii=False, indent=1))
sys.exit(1 if fail else 0)
