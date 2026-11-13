#!/usr/bin/env python3
"""PreToolUse: exige uma consulta ao graphify antes da primeira exploração de código na sessão.

Dois modos (argumento):
  marca  (matcher Bash)                -> `graphify query|explain|path|affected` grava o marcador da sessão; nunca bloqueia.
  exige  (matcher Read|Grep|Glob|Bash) -> sem marcador, bloqueia a exploração do código do projeto e diz o comando.

O marcador vale para a sessão inteira (o id vem do hook), inclusive para os subagentes dela: uma consulta
libera o resto. O objetivo é economizar tokens: o grafo aponta arquivo e linhas, e a leitura fica em offset/limit.
Só atua se o projeto tiver `graphify-out/graph.json`. Arquivos fora do projeto, docs, .claude/, tools/ e
dependências não são bloqueados. Qualquer erro do próprio hook libera a chamada (nunca trava o trabalho).
"""
import json
import os
import re
import sys
import tempfile

GRAFO = re.compile(r"\bgraphify\s+(query|explain|path|affected)\b")
# grep/rg/find no começo do comando ou depois de ; && || (não depois de um pipe: `docker ps | grep x` passa).
BUSCA_BASH = re.compile(r"(^|;|&&|\|\|)\s*(grep|egrep|rg|find|ag|ack)\s")
EXT_CODIGO = {
    ".php", ".py", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte", ".go", ".rs", ".java", ".kt",
    ".rb", ".cs", ".c", ".h", ".cpp", ".hpp", ".swift", ".scala", ".dart", ".lua", ".sql",
}
EXT_NAO_CODIGO = {".md", ".json", ".txt", ".yml", ".yaml", ".toml", ".lock", ".csv", ".log", ".env", ".html", ".css"}
PASTAS_LIVRES = {".claude", ".git", "tools", "graphify-out", "node_modules", "vendor", "dist", "build", "storage"}
SEM_GRAFO = (
    "Consulte o graphify antes de explorar o código (economiza tokens): "
    'graphify query "<pergunta em inglês>" --graph graphify-out/graph.json '
    "(ou explain/path/affected), a partir da raiz do projeto; se o comando não existir, adicione o diretório "
    "do graphify ao PATH (o CLAUDE.md diz onde). Depois leia só o trecho necessário com offset/limit."
)


def marcador(sessao: str) -> str:
    seguro = re.sub(r"[^A-Za-z0-9_-]", "_", sessao or "sem-sessao")
    return os.path.join(tempfile.gettempdir(), f"graphify-consultado-{seguro}")


def relativo(projeto: str, alvo: str):
    """Caminho relativo ao projeto, ou None se o alvo está fora dele."""
    if not alvo:
        return ""
    absoluto = alvo if os.path.isabs(alvo) else os.path.join(projeto, alvo)
    rel = os.path.relpath(os.path.normpath(absoluto), projeto).replace("\\", "/")
    return None if rel == ".." or rel.startswith("../") else rel


def livre(rel: str) -> bool:
    return any(parte in PASTAS_LIVRES for parte in rel.split("/"))


def main() -> int:
    modo = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        dados = json.load(sys.stdin)
    except Exception:
        return 0
    ferramenta = dados.get("tool_name", "")
    entrada = dados.get("tool_input") or {}
    arquivo_marca = marcador(str(dados.get("session_id", "")))

    if modo == "marca":
        if ferramenta == "Bash" and GRAFO.search(str(entrada.get("command", ""))):
            open(arquivo_marca, "a").close()
        return 0

    if modo != "exige" or os.path.exists(arquivo_marca):
        return 0

    projeto = os.path.realpath(os.environ.get("CLAUDE_PROJECT_DIR") or dados.get("cwd") or os.getcwd())
    if not os.path.exists(os.path.join(projeto, "graphify-out", "graph.json")):
        return 0

    bloqueia = False
    if ferramenta == "Read":
        rel = relativo(projeto, str(entrada.get("file_path", "")))
        bloqueia = rel is not None and not livre(rel) and os.path.splitext(rel)[1].lower() in EXT_CODIGO
    elif ferramenta in ("Grep", "Glob"):
        rel = relativo(projeto, str(entrada.get("path", "")))
        filtro = str(entrada.get("glob", "")) or (str(entrada.get("pattern", "")) if ferramenta == "Glob" else "")
        so_docs = os.path.splitext(filtro)[1].lower() in EXT_NAO_CODIGO
        bloqueia = rel is not None and not livre(rel) and not so_docs
    elif ferramenta == "Bash":
        comando = str(entrada.get("command", ""))
        bloqueia = not GRAFO.search(comando) and bool(BUSCA_BASH.search(comando))

    if bloqueia:
        print(SEM_GRAFO, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        sys.exit(0)
