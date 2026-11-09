// Revisão de código pela DeepSeek: manda o diff e o conteúdo completo dos arquivos que ele altera
// numa chamada só e grava a resposta.
//
// Uso:
//   node tools/revisar-deepseek.mjs --patch etapa.patch --out revisao.md [--api deepseek|openrouter]
//        [--root pasta] [--model id] [--effort high|max] [--extra arquivo]... [--tudo]
//
// --api     deepseek (padrão): API oficial, https://api.deepseek.com; openrouter: pelo OpenRouter
// --root    pasta do código a revisar (padrão: a pasta atual)
// --extra   arquivo a mais para dar contexto (pode repetir), relativo ao --root
// --effort  raciocínio na API oficial (high é o padrão dela; max dá mais espaço de saída)
// --tudo    inclui também as hipóteses de confiança baixa (mais cobertura, bem mais ruído). Sem isto, só entra o
//           que tem cenário concreto no código mostrado: confiança média ou alta.
// A chave vem da variável de ambiente (DEEPSEEK_API_KEY ou OPENROUTER_API_KEY) ou da linha
// correspondente no .env.local da raiz do projeto (fora do git). Nunca no código.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  // A última ocorrência vale (a nova tentativa acrescenta opções no fim)
  const i = args.lastIndexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const patchPath = opt('patch');
const outPath = opt('out');
const root = resolve(opt('root', process.cwd()));
const api = opt('api', 'deepseek');
const official = api === 'deepseek';
const model = opt('model', official ? 'deepseek-flash' : 'deepseek/deepseek-v4.1-flash-1017');
const extra = args.flatMap((a, i) => (a === '--extra' ? [args[i + 1]] : []));
const keyName = official ? 'DEEPSEEK_API_KEY' : 'OPENROUTER_API_KEY';
const envFile = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
const key = process.env[keyName]
  ?? (existsSync(envFile) ? new RegExp(`^${keyName}=(.+)$`, 'm').exec(readFileSync(envFile, 'utf8'))?.[1]?.trim() : undefined);

if (!patchPath || !outPath) {
  console.error('uso: --patch <arquivo> --out <arquivo> [--root <pasta>] [--model <id>] [--extra <arquivo>]');
  process.exit(2);
}
if (!key) {
  console.error(`Defina ${keyName} no ambiente ou no .env.local da raiz do projeto.`);
  process.exit(2);
}

const patch = readFileSync(patchPath, 'utf8');
// Arquivo novo já vem inteiro no diff; arquivo alterado vai completo, para o modelo ver o contexto
const sections = patch.split(/^(?=diff --git )/m);
const modified = sections
  .filter(s => !/^new file mode/m.test(s))
  .map(s => /^\+\+\+ b\/(.+)$/m.exec(s)?.[1])
  .filter(Boolean);
const files = [...new Set([...modified, ...extra])].filter(f => existsSync(join(root, f)));
const sources = files.map(f => `===== ${f} =====\n${readFileSync(join(root, f), 'utf8')}`).join('\n\n');

// Descrição do projeto para o revisor: tools/revisao-contexto.md (comentários HTML do arquivo são ignorados)
const ctxFile = join(root, 'tools', 'revisao-contexto.md');
const contexto = existsSync(ctxFile)
  ? readFileSync(ctxFile, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim()
  : 'Projeto sem tools/revisao-contexto.md: infira a stack pelos arquivos.';

const tudo = args.includes('--tudo');
const system = [
  'Você é um revisor de código sênior. Revise arquivo por arquivo, sem pular nenhum, e liste os',
  'bugs que encontrar: corrida, estado inconsistente, segurança (mensagem do cliente sem validar, sessão,',
  'SQL), vazamento de recurso, regressão, e também uso errado das bibliotecas do projeto.',
  'Para cada um: severidade (alta/média/baixa), confiança (alta/média/baixa), arquivo:linha e um cenário',
  'concreto de falha.',
  tudo
    ? 'Na dúvida, inclua marcando confiança baixa em vez de omitir.'
    : [
      'Só liste o que você consegue demonstrar com um cenário concreto no código mostrado (confiança média ou alta).',
      'NÃO liste: hipóteses que dependem de código que você não viu; "se um cliente adulterado enviar..." quando o',
      'servidor valida a mensagem; endurecimento genérico (mais um try/catch, mais uma guarda) sem falha concreta;',
      'nem o que a seção "Falsos já vistos" de tools/revisao-contexto.md disser que já foi verificado e é falso.',
      'Ordene da severidade maior para a menor e termine com uma tabela-resumo (#, severidade, confiança, local).',
    ].join(' '),
  'Não comente estilo nem sugira refatoração. Responda em português do Brasil, em markdown.',
].join(' ');
const user = [
  contexto,
  '',
  '## Diff da etapa',
  '```diff',
  patch,
  '```',
  '',
  '## Conteúdo atual completo dos arquivos alterados',
  sources,
].join('\n');

const approxTokens = Math.round((system.length + user.length) / 3.5);
console.error(`Enviando ${files.length} arquivos + diff (~${approxTokens} tokens) para ${model}…`);

/** API oficial (https://api-docs.deepseek.com): thinking ligado por padrão; o raciocínio vem em reasoning_content. */
async function askOfficial() {
  const effort = opt('effort', 'high');
  // Doc: saída padrão 64K com thinking e 128K com "max"; até 384K
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    reasoning_effort: effort,
    max_tokens: Number(opt('max-tokens', effort === 'max' ? 128000 : 64000)),
  };
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // A doc fecha a conexão se a inferência não começar em 10 min; a resposta em si pode demorar mais
    signal: AbortSignal.timeout(40 * 60 * 1000),
  });
  // Enquanto espera, o servidor manda linhas em branco antes do JSON
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text.trim()); } catch { data = { error: text.slice(0, 500) }; }
  return { res, data };
}

/** Preço da doc oficial (US$ por milhão), pico: 01-04h e 06-10h UTC, seg a sex; fora dele custa metade. */
function officialCost(u) {
  const now = new Date();
  const h = now.getUTCHours();
  const weekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
  const peak = weekday && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
  const flash = { hit: 0.006, miss: 0.3, out: 1.2 };
  const pro = { hit: 0.044, miss: 1.32, out: 3.96 };
  const p = model.includes('pro') ? pro : flash;
  const k = peak ? 1 : 0.5;
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? u.prompt_tokens ?? 0;
  return (k * (hit * p.hit + miss * p.miss + (u.completion_tokens ?? 0) * p.out)) / 1e6;
}

async function ask(maxTokens, reasoningTokens) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    usage: { include: true },
    // Sem limite o OpenRouter reserva o máximo do modelo e recusa com saldo baixo
    max_tokens: maxTokens,
    // --provider fixa um provedor (ex.: DeepSeek) sem cair para outro; sem ele, o mais barato primeiro.
    // Por padrão exclui provedores em fp4 (modelo comprimido, revisa pior); fp8 é a precisão nativa da DeepSeek
    // (com provedor fixo não filtra: a DeepSeek oficial não declara a precisão e seria descartada)
    provider: opt('provider')
      ? { order: [opt('provider')], allow_fallbacks: false }
      : { sort: 'price', quantizations: opt('quant', 'fp8,bf16,fp16,fp32').split(',') },
    // Orçamento próprio para o raciocínio: sem ele o modelo pode gastar tudo pensando e não responder
    ...(reasoningTokens > 0 ? { reasoning: { max_tokens: reasoningTokens } } : {}),
  };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20 * 60 * 1000),
  });
  return { res, data: await res.json().catch(() => null) };
}

// Ajusta sozinho e tenta de novo (até 4 vezes) em vez de falhar na primeira
let maxTokens = Number(opt('max-tokens', 64000));
let reasoningTokens = Number(opt('reasoning-tokens', 24000));
const started = Date.now();
let res;
let data;
// Teto imposto pelo saldo: depois de um 402, o espaço total nunca volta a subir acima dele
let cap = 128000;
for (let attempt = 1; attempt <= 4; attempt++) {
  if (official) {
    // API oficial: sem saldo reservado nem provedores; só repete se a resposta vier cortada
    ({ res, data } = await askOfficial());
    const c = data?.choices?.[0];
    if (res.ok && c?.message?.content && c.finish_reason !== 'length') break;
    if (c?.finish_reason !== 'length' || attempt === 2) break;
    args.push('--effort', 'max', '--max-tokens', '256000');
    console.error('Resposta cortada: de novo com raciocínio max e 256K de saída…');
    continue;
  }
  ({ res, data } = await ask(maxTokens, reasoningTokens));
  const choice = data?.choices?.[0];
  // Resposta cortada (finish_reason "length") também conta como falha: a revisão viria pela metade
  if (res.ok && choice?.message?.content && choice.finish_reason !== 'length') break;
  const afford = /can only afford (\d+)/.exec(data?.error?.message ?? '');
  if (res.status === 402 && afford) {
    // Saldo não cobre a reserva de saída: usa o que ele permite, com folga
    maxTokens = Math.floor(Number(afford[1]) * 0.9);
    cap = maxTokens;
    reasoningTokens = Math.min(reasoningTokens || maxTokens, Math.floor(maxTokens * 0.5));
    if (maxTokens < 8000) break; // saldo baixo demais para uma revisão útil
  } else if (res.status === 400 && reasoningTokens > 0) {
    reasoningTokens = 0; // provedor não aceita o parâmetro de raciocínio
  } else if (choice?.finish_reason === 'length') {
    // Pensou demais: mais espaço total (até o teto do saldo) e raciocínio limitado a no máximo metade
    maxTokens = Math.min(maxTokens * 2, cap);
    reasoningTokens = Math.floor((reasoningTokens || maxTokens) / 2);
  } else {
    break;
  }
  console.error(`Tentativa ${attempt} falhou (HTTP ${res.status}); de novo com max_tokens ${maxTokens} e raciocínio ${reasoningTokens}…`);
}
if (!res.ok || !data?.choices?.[0]?.message?.content || data.choices[0].finish_reason === 'length') {
  console.error(`Falhou (HTTP ${res.status}, fim: ${data?.choices?.[0]?.finish_reason ?? '-'}):`, JSON.stringify(data?.error ?? data).slice(0, 800));
  if (res.status === 402) console.error('Saldo do OpenRouter insuficiente: adicione créditos em https://openrouter.ai/settings/credits');
  process.exit(1);
}

writeFileSync(outPath, data.choices[0].message.content);
const u = data.usage ?? {};
const usd = official ? officialCost(u) : u.cost;
const cost = typeof usd === 'number' ? ` · custo US$ ${usd.toFixed(4)}${official ? ' (estimado pela tabela)' : ''}` : '';
const thinking = u.completion_tokens_details?.reasoning_tokens;
console.error(
  `ok em ${Math.round((Date.now() - started) / 1000)} s · ${data.model ?? model} · entrada ${u.prompt_tokens ?? '?'} tokens · saída ${u.completion_tokens ?? '?'} tokens${thinking ? ` (${thinking} de raciocínio)` : ''}${cost}`,
);
console.error(`Revisão gravada em ${outPath}`);
