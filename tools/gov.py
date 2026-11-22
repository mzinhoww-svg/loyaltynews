#!/usr/bin/env python3
"""loyalty-governance: CLI + minimal MCP stdio server (stdlib only).

Usage:
  python3 tools/gov.py mcp         # run the MCP server over stdio
  python3 tools/gov.py rules       # print governance/rules.json
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES_FILE = ROOT / "governance" / "rules.json"
PROTOCOL_VERSION = "2024-11-05"


def load_rules():
    try:
        return json.loads(RULES_FILE.read_text(encoding="utf-8")).get("rules", [])
    except FileNotFoundError:
        return []


TOOLS = {
    "ping": {
        "description": "Health check; returns 'pong'.",
        "inputSchema": {"type": "object", "properties": {}},
        "run": lambda args: "pong",
    },
    "list_rules": {
        "description": "List governance rules from governance/rules.json.",
        "inputSchema": {"type": "object", "properties": {}},
        "run": lambda args: json.dumps(load_rules(), ensure_ascii=False, indent=2),
    },
}


def handle(msg):
    method, params = msg.get("method"), msg.get("params") or {}
    if method == "initialize":
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "loyalty-governance", "version": "0.1.0"},
        }
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": [
            {"name": n, "description": t["description"], "inputSchema": t["inputSchema"]}
            for n, t in TOOLS.items()
        ]}
    if method == "tools/call":
        tool = TOOLS.get(params.get("name"))
        if not tool:
            raise KeyError(f"unknown tool: {params.get('name')}")
        try:
            text, err = tool["run"](params.get("arguments") or {}), False
        except Exception as e:  # tool errors are reported in-band
            text, err = str(e), True
        return {"content": [{"type": "text", "text": text}], "isError": err}
    raise LookupError(method)


def serve():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "id" not in msg:  # notification (e.g. notifications/initialized)
            continue
        resp = {"jsonrpc": "2.0", "id": msg["id"]}
        try:
            resp["result"] = handle(msg)
        except LookupError:
            resp["error"] = {"code": -32601, "message": f"method not found: {msg.get('method')}"}
        except Exception as e:
            resp["error"] = {"code": -32603, "message": str(e)}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "mcp":
        serve()
    elif cmd == "rules":
        print(json.dumps(load_rules(), ensure_ascii=False, indent=2))
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
