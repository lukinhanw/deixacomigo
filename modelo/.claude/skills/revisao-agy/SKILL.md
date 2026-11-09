---
name: revisao-agy
description: Revisão de código pelo Antigravity CLI (agy) com gemini-3.8-flash-high. Grava o diff e a tarefa em arquivos e manda o agy ler (sem limite de tamanho do argumento), roda em segundo plano e tria os achados. Use ao revisar uma etapa ou um conjunto de mudanças com o agy.
---

# Revisão com o agy

O agy só gera a revisão. Quem tria os achados é o agente principal, conferindo cada um no código.
Requer o `agy` instalado; se não existir, avise o usuário e pule esta revisão.

## 1. Diff em arquivo

- Base: o commit anterior à etapa. Arquivo novo precisa estar no índice (`git add -N`).
- `git diff <base> > <scratchpad>/revisao/etapa.patch` — a etapa inteira num arquivo só.
- O conteúdo não vai no argumento do comando (o Windows corta em ~32 KB): o agy lê o arquivo. Só divida
  em 2 partes se o patch passar de ~150 KB.

## 2. Tarefa em arquivo

`<scratchpad>/revisao/tarefa.md` (troque `<raiz>` pelo caminho absoluto do projeto):

```
MODO SOMENTE LEITURA: não crie nem edite arquivos e não rode comandos. Use só a leitura de arquivos.

Leia o diff em <caminho absoluto do etapa.patch>.

Revise esse diff. Contexto do projeto: leia <raiz>/tools/revisao-contexto.md. O código atual está em <raiz>. Procure só bugs reais: corrida, estado inconsistente, segurança (entrada sem validar, sessão, SQL), vazamento de recurso, regressão. Para cada um: severidade (alta/média/baixa), arquivo:linha e um cenário concreto de falha. Concentre-se nos arquivos do diff; abra outros só para confirmar um bug. Não comente estilo nem sugira refatoração. Responda em português do Brasil, só com o texto da revisão.
```

## 3. Rodar

`<scratchpad>/revisao/run.sh` (troque `<raiz>` pela raiz do projeto no formato do Bash):

```bash
#!/bin/bash
# No Git Bash o $LOCALAPPDATA vem com barras invertidas (C:\Users\...): converta com cygpath, senão o PATH não pega
command -v agy >/dev/null || export PATH="$PATH:$(cygpath -u "$LOCALAPPDATA" 2>/dev/null)/agy/bin"
S="$(cd "$(dirname "$0")" && pwd)"
W() { cygpath -w "$1" 2>/dev/null || echo "$1"; }
cd <raiz> || exit 1
agy -p "Leia e execute a tarefa descrita no arquivo $(W "$S/tarefa.md")." \
  --add-dir "$(W "$S")" \
  --model gemini-3.8-flash-high --effort high --print-timeout 1500s \
  > "$S/out.txt" 2> "$S/err.txt"
echo "exit=$? bytes_out=$(wc -c < "$S/out.txt")"
```

- `--add-dir` dá ao agy acesso à pasta do scratchpad (fora do projeto).
- Leva de 15 a 25 min: rode sempre com `run_in_background`. Uma chamada por vez (em paralelo a cota acaba mais rápido).
- Problemas comuns, veja `err.txt`:
  - `429 RESOURCE_EXHAUSTED`: a cota acabou; avise o usuário.
  - `"write_file" permission ... auto-denied`: o agy tentou gravar arquivo. Reforce o modo somente leitura na tarefa e rode de novo. Nunca usar `--dangerously-skip-permissions`.
  - 0 bytes com o agy vivo há menos de 25 min: ainda está rodando.

## 4. Triagem

- Confirme cada achado lendo o código antes de corrigir; quando der, prove com um teste.
- O que contradiz uma regra do README é decisão de design: relate ao usuário em vez de mudar.
- Depois das correções, rode a verificação (tipos, testes, navegador) descrita no CLAUDE.md.
