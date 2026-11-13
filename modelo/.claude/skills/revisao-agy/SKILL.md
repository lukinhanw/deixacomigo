---
name: revisao-agy
description: Revisão de código pelo Antigravity CLI (agy, Gemini 4 Hydrogen medium por padrão) por um script que fecha o escopo (pacote com diff e arquivos), limita as chamadas de ferramenta, faz uma única retomada e nunca devolve saída vazia em silêncio. Roda em segundo plano; depois o agente tria os achados. Use ao revisar uma etapa ou um conjunto de mudanças com o agy.
---

# Revisão com o agy

O agy só gera a revisão. Quem tria os achados é o agente principal, conferindo cada um no código.
Requer o `agy` instalado (PATH, `~/.local/bin`, `LOCALAPPDATA/agy/bin` ou `AGY_BIN`); se não existir, avise o usuário e pule esta revisão.

## 1. Rodar (sempre em segundo plano, da raiz do projeto)

```bash
node tools/revisar-agy.mjs --out <scratchpad>/revisao
```

- Sem `--repo`, revisa o repositório da raiz (`.`). Com repositórios git aninhados ou independentes (ex.: `back/` e `front/`), passe um `--repo` para cada um, relativo à raiz.
- O script lê as mudanças sem mexer no índice: não use `git add -N` nem `git reset` por causa dele.
- Para cada repositório ele grava `pacote-<repo>.md` (contexto de `tools/revisao-contexto.md`, regras do `AGENTS.md`, falsos positivos já vistos, diff e conteúdo atual dos arquivos alterados) e manda o agy ler só esse arquivo. Pacote acima de ~200 KB é dividido por diretório.
- `--base <commit>` para revisar uma etapa já commitada; `--max-tools 25` e `--timeout 900` (segundos) ajustam o orçamento; `--dry-run` só monta os pacotes e mostra os tamanhos; `--sem-schema` desliga a saída estruturada.
- Padrão: `--model gemini-4-hydrogen-medium` e o prompt do subagente `revisor` (`.claude/agents/revisor.md`: ataca as suposições do autor, uma prova por achado, resposta em markdown). `--prompt-simples` volta ao prompt curto com saída em JSON (`--sem-schema` a desliga). `--pacote <arquivo>` revisa um pacote pronto, para comparar modelos com a mesma entrada. `--model gemini-4-hydrogen-high` só em mudança de risco: nos testes de 13/11/2026 o `medium` achou o mesmo e foi mais rápido.
- Uma execução por vez (trava em `<out>/.revisar-agy.lock`), porque a cota é a mesma.
- Passou do orçamento de ferramentas ou do tempo: o script encerra o agy e faz **uma única retomada** da mesma sessão pedindo o resultado. Não repita à mão em seguida.

## 2. Ler o resultado

- `achados-<repo>.md` (e `.json`): os achados. Sem achado: "Nenhum achado."
- `parcial-<repo>.md`: o agy não respondeu; o arquivo lista o que ele fez (ferramentas, arquivos lidos, erro). Exit code 2.
- `resultado-<repo>.json`: o evento `result` bruto do agy, gravado sempre (sucesso ou não). Se um sucesso aparecer como "sem resposta", a saída veio num campo inesperado: está aqui.
- `metricas.jsonl`: uma linha por pacote (segundos, turnos, ferramentas, chamadas fora de escopo, tokens, desfecho). Use para ajustar os limites.
- Problemas comuns (mensagem do próprio script):
  - `503 No capacity available` / `429`: o servidor do agy recusou. O script não retoma (não adianta); tente mais tarde e avise o usuário.
  - `--effort` junto de um modelo `…-high` é rejeitado: o nome do modelo já carrega o esforço (o script cuida disso).
  - Exit 3: agy não encontrado ou outra revisão em andamento.
  - `Authentication required`: o agy perdeu o login (acontece depois de reiniciar a máquina). Não dá para logar numa sessão não interativa: peça ao usuário para rodar `agy` e logar, e repita.
  - Qualquer falha (503/429, timeout, `parcial-*.md`, login): use o reserva `sonnet` no mesmo pacote (skill `revisao`).
- Nunca usar `--dangerously-skip-permissions`.

## 3. Triagem

- Cada achado é uma hipótese: confirme lendo o código antes de corrigir; quando der, prove com um teste.
- O que contradiz uma regra do CLAUDE.md é decisão de design: relate ao usuário em vez de mudar.
- O que a prova mostrar ser falso entra na seção "Falsos positivos" da skill `revisao` (linha `- agy: …`): o script injeta essa lista no próximo pacote.
- Depois das correções, rode a verificação (tipos, testes, navegador) descrita no CLAUDE.md.
