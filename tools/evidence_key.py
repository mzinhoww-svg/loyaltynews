#!/usr/bin/env python3
import sys,pathlib,json,hashlib
from gov import Gov,canon,digest
root=pathlib.Path(__file__).resolve().parents[1];g=Gov(root);task=sys.argv[1];g.task(task);arts=[]
for x in sorted(sys.argv[2:]):
 b=g.safe(x).read_bytes();arts.append({'caminho':x,'sha256':digest(b),'bytes':len(b)})
print(json.dumps({'artefatos':arts,'chave_idempotencia':digest(canon([task,arts]))},ensure_ascii=False,indent=2))
