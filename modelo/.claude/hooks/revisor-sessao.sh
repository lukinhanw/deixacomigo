#!/bin/bash
# SessionStart: informa ao Claude o revisor externo da sessão (variável REVISOR).
# Defina com `REVISOR=agy claude` ou em "env" do .claude/settings.local.json; sem ela, o Claude pergunta.
case "$REVISOR" in
  codex|agy|ambos|nenhum)
    echo "Revisor externo desta sessão: $REVISOR (definido pela variável REVISOR). O usuário pode trocar a qualquer momento." ;;
  "")
    echo "Revisor externo desta sessão: não definido. Na primeira resposta, antes de qualquer outra coisa, pergunte ao usuário com AskUserQuestion qual usar: codex, agy, ambos ou nenhum." ;;
  *)
    echo "Revisor externo: REVISOR=\"$REVISOR\" não é válido (use codex, agy, ambos ou nenhum). Na primeira resposta, avise e pergunte ao usuário com AskUserQuestion qual usar." ;;
esac
