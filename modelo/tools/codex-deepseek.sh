#!/bin/bash
# Revisão com o Codex CLI usando a DeepSeek como modelo (Responses API oficial), sem mexer no
# ~/.codex/config.toml e sem gastar a assinatura da OpenAI (compartilhada).
#
# Uso (dentro do repositório a revisar):
#   bash tools/codex-deepseek.sh --uncommitted
#   bash tools/codex-deepseek.sh --base <branch>
#   bash tools/codex-deepseek.sh --commit <SHA>
# Modelo: deepseek-flash (troque com DEEPSEEK_MODEL=deepseek-v4-pro).
# A chave vem de DEEPSEEK_API_KEY no ambiente ou do .env.local na raiz do projeto (fora do git).
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "$DEEPSEEK_API_KEY" ] && [ -f "$RAIZ/.env.local" ]; then
  DEEPSEEK_API_KEY=$(grep '^DEEPSEEK_API_KEY=' "$RAIZ/.env.local" | cut -d= -f2-)
fi
if [ -z "$DEEPSEEK_API_KEY" ]; then
  echo "Defina DEEPSEEK_API_KEY no ambiente ou no .env.local da raiz do projeto." >&2
  exit 2
fi
export DEEPSEEK_API_KEY
exec codex review \
  -c model_provider=deepseek \
  -c 'model_providers.deepseek={name="DeepSeek",base_url="https://api.deepseek.com/v1",env_key="DEEPSEEK_API_KEY",wire_api="responses"}' \
  -c model="${DEEPSEEK_MODEL:-deepseek-flash}" -c model_reasoning_effort="high" \
  "$@"
