#!/bin/bash
# SessionStart: informa ao Claude o revisor da sessão (variável REVISOR).
# Defina com `REVISOR=sonnet claude` ou em "env" do .claude/settings.local.json; sem ela, o Claude pergunta.
case "$REVISOR" in
  sonnet)
    echo "Revisor desta sessão: sonnet (subagente interno \`revisor\`, com contexto limpo, pela skill \`revisao\`; gasta tokens do Claude, não depende de outra assinatura). O usuário pode trocar a qualquer momento." ;;
  agy)
    echo "Revisor desta sessão: agy (Antigravity CLI, Gemini 4 Hydrogen medium, pela skill \`revisao\`), com o subagente \`revisor\` (Sonnet) de reserva se o agy falhar (503, timeout, login expirado). O usuário pode trocar a qualquer momento." ;;
  codex|ambos|nenhum)
    echo "Revisor externo desta sessão: $REVISOR (definido pela variável REVISOR). O usuário pode trocar a qualquer momento." ;;
  "")
    echo "Revisor desta sessão: não definido. Na primeira resposta, antes de qualquer outra coisa, pergunte ao usuário com AskUserQuestion qual usar: sonnet, codex, agy, ambos ou nenhum." ;;
  *)
    echo "Revisor: REVISOR=\"$REVISOR\" não é válido (use sonnet, codex, agy, ambos ou nenhum). Na primeira resposta, avise e pergunte ao usuário com AskUserQuestion qual usar." ;;
esac
