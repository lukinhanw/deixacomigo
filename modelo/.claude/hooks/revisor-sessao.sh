#!/bin/bash
# SessionStart: informa ao Claude o revisor da sessão (variável REVISOR).
# O padrão do projeto é o agy (REVISOR=agy em "env" do .claude/settings.local.json). O Codex não é mais usado.
case "$REVISOR" in
  sonnet)
    echo "Revisor desta sessão: sonnet (subagente interno \`revisor\`, com contexto limpo, pela skill \`revisao\`; gasta tokens do Claude, não depende de outra assinatura). O usuário pode trocar a qualquer momento." ;;
  agy|"")
    echo "Revisor desta sessão: agy (Antigravity CLI, Gemini 4 Hydrogen medium, pela skill \`revisao\`), com o subagente \`revisor\` (Sonnet) de reserva se o agy falhar (503, timeout, login expirado). O usuário pode trocar a qualquer momento." ;;
  nenhum)
    echo "Revisor desta sessão: nenhum. Não rode revisão sem pedido do usuário. Ele pode trocar a qualquer momento." ;;
  *)
    echo "Revisor: REVISOR=\"$REVISOR\" não é válido (use agy, sonnet ou nenhum). Avise o usuário e use o agy." ;;
esac
