#!/usr/bin/env node
// revisar-agy: revisão de código com o agy (Antigravity CLI) com escopo fechado, orçamento de ferramentas e
// uma retomada. Node puro, sem dependências. Roda o `agy -p` oficial, local e sequencial.
//
// Uso: node tools/revisar-agy.mjs --repo back [--repo front] [--base <commit>] [--out <pasta>]
//        [--max-tools 25] [--timeout 900] [--model gemini-4-hydrogen-medium] [--pacote <arquivo>]
//        [--prompt-simples] [--dry-run]
//
// Por quê: sem teto, o agy explora o repositório por 25 min e, no modo texto, só imprime no fim do turno
// (execução de 12/11/2026: 94 chamadas de ferramenta, 0 bytes). Aqui o agy recebe um pacote com o diff e o
// conteúdo dos arquivos alterados, o stream-json permite contar ferramentas, e estourar o orçamento encerra
// o agy e pede o resultado numa única retomada da mesma sessão. O prompt padrão é o do subagente `revisor`
// (.claude/agents/revisor.md): mesmo método do revisor Sonnet, reserva quando o agy falha.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITE_LINHAS_ARQUIVO = 600; // acima disso entram só janelas ao redor dos trechos alterados
export const JANELA_LINHAS = 60;
export const TETO_PACOTE = 200_000; // bytes; acima disso o pacote se divide por diretório
const TETO_ARQUIVO_NOVO = 200_000;
const FORA_DE_ESCOPO = /(^|\/)(vendor|node_modules|storage)\//;
const IGNORAR = /(^|\/)(package-lock\.json|composer\.lock|yarn\.lock|pnpm-lock\.yaml|dist\/|build\/|vendor\/|node_modules\/|storage\/)|\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|map|min\.js)$/i;

// ---------------------------------------------------------------------------------------------- argumentos
export function lerArgumentos(argv) {
  const o = { repos: [], base: 'HEAD', maxTools: 25, timeout: 900, model: 'gemini-4-hydrogen-medium', effort: null, dryRun: false, out: null, raiz: null, schema: true, pacote: null, promptRevisor: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--repo') o.repos.push(v());
    else if (a === '--base') o.base = v();
    else if (a === '--out') o.out = v();
    else if (a === '--raiz') o.raiz = v();
    else if (a === '--max-tools') o.maxTools = Number(v());
    else if (a === '--timeout') o.timeout = Number(v());
    else if (a === '--model') o.model = v();
    else if (a === '--effort') o.effort = v();
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--sem-schema') o.schema = false;
    else if (a === '--pacote') o.pacote = v();
    else if (a === '--prompt-revisor') o.promptRevisor = true;
    else if (a === '--prompt-simples') o.promptRevisor = false;
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (o.repos.length === 0) o.repos.push('.');
  return o;
}

// ---------------------------------------------------------------------------------------------------- git
function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

/** Divide um diff unificado em { arquivo -> trecho do diff }. */
export function dividirDiff(diff) {
  const porArquivo = new Map();
  const partes = diff.split(/^(?=diff --git )/m).filter((p) => p.startsWith('diff --git '));
  for (const p of partes) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(p);
    if (m) porArquivo.set(m[2], p);
  }
  return porArquivo;
}

/** Patch de arquivo novo montado aqui (sem `git add -N` e sem `git diff --no-index`). */
export function patchArquivoNovo(caminho, conteudo) {
  const linhas = conteudo.split('\n');
  if (linhas[linhas.length - 1] === '') linhas.pop();
  return [`diff --git a/${caminho} b/${caminho}`, 'new file mode 100644', '--- /dev/null', `+++ b/${caminho}`, `@@ -0,0 +1,${linhas.length} @@`, ...linhas.map((l) => `+${l}`), ''].join('\n');
}

/** Mudanças do repositório sem tocar no índice: diff dos rastreados + patch dos arquivos novos. */
export function coletarMudancas(repo, base = 'HEAD') {
  const diff = git(repo, ['diff', base, '--no-color', '--no-ext-diff', '-U3']);
  if (diff.status !== 0) throw new Error(`git diff falhou em ${repo}: ${(diff.stderr || '').slice(0, 200)}`);
  const porArquivo = dividirDiff(diff.stdout);
  for (const caminho of [...porArquivo.keys()]) if (IGNORAR.test(caminho)) porArquivo.delete(caminho);
  const apagados = new Set(git(repo, ['diff', base, '--name-only', '--diff-filter=D']).stdout.split('\n').filter(Boolean));
  const novos = git(repo, ['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean);
  for (const caminho of novos) {
    if (IGNORAR.test(caminho)) continue;
    const abs = join(repo, caminho);
    try {
      if (statSync(abs).size > TETO_ARQUIVO_NOVO) continue;
      const conteudo = readFileSync(abs, 'utf8');
      if (conteudo.includes('\u0000')) continue;
      porArquivo.set(caminho, patchArquivoNovo(caminho, conteudo));
    } catch {
      /* some entre o ls-files e a leitura: ignora */
    }
  }
  return { porArquivo, apagados: [...apagados].filter((c) => !IGNORAR.test(c)) };
}

// ------------------------------------------------------------------------------------------------ pacote
function intervalosAlterados(patch) {
  const faixas = [];
  for (const m of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const inicio = Number(m[1]);
    faixas.push([inicio, inicio + Math.max(Number(m[2] ?? 1), 1) - 1]);
  }
  return faixas;
}

/** Conteúdo atual do arquivo com números de linha: inteiro até o limite; acima, janelas ao redor dos trechos alterados. */
export function conteudoParaPacote(conteudo, patch, limite = LIMITE_LINHAS_ARQUIVO, janela = JANELA_LINHAS) {
  const linhas = conteudo.split('\n');
  if (linhas[linhas.length - 1] === '') linhas.pop();
  const numeradas = (de, ate) => linhas.slice(de - 1, ate).map((l, i) => `${de + i}: ${l}`).join('\n');
  if (linhas.length <= limite) return numeradas(1, linhas.length);
  const janelas = [];
  for (const [ini, fim] of intervalosAlterados(patch)) {
    const de = Math.max(1, ini - janela);
    const ate = Math.min(linhas.length, fim + janela);
    const ultima = janelas[janelas.length - 1];
    if (ultima && de <= ultima[1] + 1) ultima[1] = Math.max(ultima[1], ate);
    else janelas.push([de, ate]);
  }
  return `(arquivo com ${linhas.length} linhas; só trechos ao redor das mudanças)\n` + janelas.map(([de, ate]) => numeradas(de, ate)).join('\n...\n');
}

/** Agrupa arquivos por diretório (dois níveis) e empacota em blocos que cabem no teto. */
export function dividirEmBlocos(tamanhos, teto = TETO_PACOTE) {
  const porDir = new Map();
  for (const [caminho, tamanho] of tamanhos) {
    const dir = caminho.split('/').slice(0, 2).join('/');
    if (!porDir.has(dir)) porDir.set(dir, []);
    porDir.get(dir).push([caminho, tamanho]);
  }
  const blocos = [];
  let atual = { arquivos: [], bytes: 0 };
  for (const arquivos of [...porDir.values()].sort((a, b) => a[0][0].localeCompare(b[0][0]))) {
    for (const [caminho, tamanho] of arquivos) {
      if (atual.arquivos.length && atual.bytes + tamanho > teto) {
        blocos.push(atual);
        atual = { arquivos: [], bytes: 0 };
      }
      atual.arquivos.push(caminho);
      atual.bytes += tamanho;
    }
  }
  if (atual.arquivos.length) blocos.push(atual);
  return blocos.map((b) => b.arquivos);
}

export function falsosPositivos(raiz) {
  const arq = join(raiz, '.claude', 'skills', 'revisao', 'SKILL.md');
  if (!existsSync(arq)) return [];
  return readFileSync(arq, 'utf8').split('\n').filter((l) => /^- agy:/.test(l)).map((l) => l.replace(/^- agy:\s*/, ''));
}

function lerSeExistir(caminho, max) {
  return existsSync(caminho) ? readFileSync(caminho, 'utf8').slice(0, max) : '';
}

/** Monta os pacotes (um por bloco de arquivos). Cada pacote traz contexto, regras, diff e conteúdo atual. */
export function montarPacotes({ repo, raiz, mudancas, teto = TETO_PACOTE }) {
  const { porArquivo } = mudancas;
  const conteudos = new Map();
  for (const [caminho, patch] of porArquivo) {
    const abs = join(repo, caminho);
    let texto = '';
    try {
      texto = conteudoParaPacote(readFileSync(abs, 'utf8'), patch);
    } catch {
      texto = '(não foi possível ler o arquivo atual)';
    }
    conteudos.set(caminho, texto);
  }
  const tamanhos = [...porArquivo.keys()].map((c) => [c, Buffer.byteLength(porArquivo.get(c)) + Buffer.byteLength(conteudos.get(c))]);
  const cabecalho = [
    '# Contexto do projeto', lerSeExistir(join(raiz, 'tools', 'revisao-contexto.md'), 8000),
    '# Regras do repositório (AGENTS.md)', lerSeExistir(join(repo, 'AGENTS.md'), 6000),
    '# Falsos positivos já vistos (não reporte)', falsosPositivos(raiz).map((l) => `- ${l}`).join('\n') || '(nenhum)',
  ].join('\n\n');
  const blocos = dividirEmBlocos(tamanhos, Math.max(teto - Buffer.byteLength(cabecalho), 20_000));
  return blocos.map((arquivos, i) => ({
    nome: blocos.length > 1 ? `${i + 1}de${blocos.length}` : '',
    arquivos,
    texto: [
      cabecalho,
      `# Diff (${arquivos.length} arquivo(s))`, '```diff', arquivos.map((c) => porArquivo.get(c)).join('\n'), '```',
      '# Conteúdo atual dos arquivos alterados', arquivos.map((c) => `## ${c}\n${conteudos.get(c)}`).join('\n\n'),
    ].join('\n\n'),
  }));
}

// ------------------------------------------------------------------------------------------------- prompt
export const SCHEMA = {
  type: 'object',
  properties: {
    achados: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severidade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
          arquivo: { type: 'string' },
          linha: { type: 'integer' },
          cenario: { type: 'string' },
        },
        required: ['severidade', 'arquivo', 'linha', 'cenario'],
      },
    },
  },
  required: ['achados'],
};

export function montarPrompt(arquivoPacote, comSchema) {
  return [
    `Revise o código descrito em ${arquivoPacote}. Leia só esse arquivo: ele traz o contexto do projeto, o diff e o conteúdo atual dos arquivos alterados.`,
    'Regras: somente leitura (não crie nem edite arquivos); abra no máximo 6 arquivos extras, só para confirmar um bug que você já suspeita; nunca leia vendor/, node_modules/ nem storage/; termine em poucos minutos.',
    'Procure só bugs reais: corrida, estado inconsistente, isolamento entre contextos (multi-tenant ou entre usuários, se o projeto tiver), segurança, vazamento de recurso, regressão. Não reporte estilo nem refatoração, nem o que está na lista de falsos positivos do pacote.',
    'Responda em português do Brasil.',
    comSchema
      ? 'Responda apenas com o JSON do schema; em cada achado, "cenario" traz a entrada e o resultado errado concretos. Sem achados: {"achados":[]}.'
      : 'Para cada bug: severidade (alta/média/baixa), arquivo:linha e um cenário concreto de falha. Sem bugs, diga isso.',
  ].join('\n');
}

/**
 * Mesmo prompt do subagente `revisor` (.claude/agents/revisor.md, sem o frontmatter), para qualquer modelo receber
 * o mesmo método (suposições do autor, prova por achado). Só muda a abertura: pacote em arquivo ou pela entrada.
 */
export function montarPromptRevisor(raiz, arquivoPacote) {
  const arq = join(raiz, '.claude', 'agents', 'revisor.md');
  if (!existsSync(arq)) throw new Error(`--prompt-revisor precisa de ${arq}`);
  const corpo = readFileSync(arq, 'utf8').replace(/^---[\s\S]*?\n---\n/, '').trim();
  const abertura = `O pacote de revisão está em ${arquivoPacote}. Leia-o inteiro (em blocos, se preciso) com a ferramenta de leitura.`;
  return `${abertura}\n\n${corpo}`;
}

export const PROMPT_RETOMADA =
  'Pare de explorar. Entregue agora os achados com o que você já leu, no mesmo formato pedido. Não abra mais arquivos.';

// ----------------------------------------------------------------------------------------------- executável
export function descobrirAgy(env = process.env) {
  if (env.AGY_BIN && existsSync(env.AGY_BIN)) return env.AGY_BIN;
  const nomes = process.platform === 'win32' ? ['agy.exe', 'agy.cmd', 'agy'] : ['agy'];
  const dirs = (env.PATH || '').split(delimiter);
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'agy', 'bin'));
  dirs.push(join(homedir(), '.local', 'bin'), join(homedir(), '.gemini', 'bin'));
  for (const d of dirs) for (const n of nomes) if (d && existsSync(join(d, n))) return join(d, n);
  return null;
}

// ------------------------------------------------------------------------------------------------ execução
const ativos = new Set();
const limparAoSair = () => {
  for (const f of ativos) matarArvore(f, 'SIGKILL');
};
process.on('exit', limparAoSair);
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => process.exit(130));

/** Encerra o agy e os processos que ele criou: filho órfão segurando o stdout atrasa o 'close' por minutos. */
export function matarArvore(filho, sinal = 'SIGTERM') {
  if (!filho.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(filho.pid), '/T', '/F']);
    else process.kill(-filho.pid, sinal);
  } catch {
    try {
      filho.kill(sinal);
    } catch {
      /* já terminou */
    }
  }
}

/**
 * Roda o agy em modo -p com stream-json e conta as chamadas de ferramenta. Passou do orçamento de
 * ferramentas ou do tempo: encerra o processo e devolve o motivo ('ferramentas' | 'tempo').
 * Eventos: init (conversation_id), step_update (step_type "tool", state "ACTIVE") e result (status, response).
 */
export function rodarAgy(agyBin, args, { maxTools = Infinity, timeoutMs, cwd, env = process.env }) {
  return new Promise((resolver) => {
    const inicio = Date.now();
    const estado = { conversationId: null, ferramentas: [], resultado: null, motivo: null, stderr: '', turnos: 0, foraDeEscopo: 0, latenciasTurno: [] };
    const vistos = new Set();
    const filho = spawn(agyBin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    ativos.add(filho);
    let buffer = '';
    const encerrar = (motivo) => {
      if (estado.motivo || estado.resultado) return;
      estado.motivo = motivo;
      estado.encerradoEmMs = Date.now() - inicio;
      matarArvore(filho, 'SIGTERM');
      setTimeout(() => matarArvore(filho, 'SIGKILL'), 3000).unref();
    };
    const tratar = (linha) => {
      let ev;
      try {
        ev = JSON.parse(linha);
      } catch {
        return;
      }
      if (ev.event === 'init') estado.conversationId = ev.conversation_id ?? ev.init?.conversation_id ?? estado.conversationId;
      else if (ev.event === 'step_update') {
        const s = ev.step_update ?? {};
        estado.conversationId ??= s.conversation_id ?? null;
        if (s.step_type === 'agent_response' && s.state === 'DONE') {
          estado.turnos++;
          if (typeof s.duration_seconds === 'number') estado.latenciasTurno.push(s.duration_seconds);
        }
        if (s.step_type === 'tool' && s.state === 'ACTIVE' && !vistos.has(s.step_index)) {
          vistos.add(s.step_index);
          const parametros = s.tool_info?.parameters ?? {};
          estado.ferramentas.push({ nome: s.tool_name, parametros });
          if (s.tool_name === 'run_command' || FORA_DE_ESCOPO.test(String(parametros.Path ?? parametros.path ?? ''))) estado.foraDeEscopo++;
          if (estado.ferramentas.length > maxTools) encerrar('ferramentas');
        }
      } else if (ev.event === 'result') {
        estado.resultado = ev.result ?? ev;
        estado.conversationId = estado.resultado.conversation_id ?? estado.conversationId;
      }
    };
    filho.stdout.on('data', (d) => {
      buffer += d.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        tratar(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    });
    filho.stderr.on('data', (d) => (estado.stderr = (estado.stderr + d.toString('utf8')).slice(-4000)));
    const relogio = setTimeout(() => encerrar('tempo'), timeoutMs);
    // Resolve quando o agy sai, com ~2 s de tolerância para a saída que ainda esteja chegando. Esperar só o
    // 'close' trava enquanto algum processo criado pelo agy (em outra sessão) segurar o stdout: nas rodadas
    // reais isso somou ~100 s ao relógio depois do encerramento.
    let terminou = false;
    const finalizar = (extra) => {
      if (terminou) return;
      terminou = true;
      ativos.delete(filho);
      clearTimeout(relogio);
      filho.stdout.destroy();
      filho.stderr.destroy();
      if (buffer.trim()) tratar(buffer);
      resolver({ ...estado, ...extra, duracaoMs: Date.now() - inicio });
    };
    filho.on('error', (e) => finalizar({ erro: e.message }));
    filho.on('exit', (codigo) => setTimeout(() => finalizar({ codigo }), 2000).unref());
    filho.on('close', (codigo) => finalizar({ codigo }));
  });
}

/** Texto útil da resposta, ou null (resposta vazia ou resultado de erro). */
export function respostaUtil(exec) {
  const r = exec.resultado;
  if (!r || r.status === 'ERROR') return null;
  // Saída estruturada pode vir como objeto em vez de string.
  const bruto = r.response !== null && typeof r.response === 'object' ? JSON.stringify(r.response) : String(r.response ?? '');
  const texto = bruto.trim();
  return texto === '' ? null : texto;
}

/** Erro do servidor do agy (sem capacidade, cota): retomar a sessão não adianta e só gasta cota. */
export function erroDoServidor(exec) {
  const erro = String(exec.resultado?.error ?? '');
  return /\b503\b|UNAVAILABLE|No capacity|\b429\b|RESOURCE_EXHAUSTED|overloaded|\b529\b/i.test(erro) ? erro : null;
}

export function extrairJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    const m = /\{[\s\S]*\}/.exec(texto);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* cai para null */
      }
    }
    return null;
  }
}

function argsAgy({ model, effort, outDir, schemaArq, prompt, retomar, printTimeoutS }) {
  const a = ['-p', prompt, '--add-dir', outDir, '--output-format', 'stream-json', '--model', model, '--print-timeout', `${printTimeoutS}s`];
  // O nome do modelo já carrega o esforço (…-high): passar --effort diferente dele é rejeitado pelo agy.
  if (effort && !/-(low|medium|high|xhigh|max)$/.test(model)) a.push('--effort', effort);
  // Nega escrita (provado: "Matches user-configured deny rule") e comandos (mesma sintaxe; a revisão só precisa ler).
  // Só desta sessão. Glob em read_file não funciona no agy.
  a.push('--settings', JSON.stringify({ permissions: { deny: ['write_file(*)', 'run_command(*)'] } }));
  if (schemaArq) a.push('--json-schema', schemaArq);
  if (retomar) a.push('--conversation', retomar);
  return a;
}

/** Revisa um pacote: execução normal e, se faltar resposta, uma única retomada pedindo o resultado. */
export async function revisarPacote({ agyBin, cwd, opcoes, outDir, schemaArq, arquivoPacote }) {
  const comuns = { model: opcoes.model, effort: opcoes.effort, outDir, schemaArq };
  const prompt = opcoes.promptRevisor ? montarPromptRevisor(cwd, arquivoPacote) : montarPrompt(arquivoPacote, Boolean(schemaArq));
  const primeira = await rodarAgy(agyBin, argsAgy({ ...comuns, prompt, printTimeoutS: opcoes.timeout + 30 }), { maxTools: opcoes.maxTools, timeoutMs: opcoes.timeout * 1000, cwd });
  let texto = respostaUtil(primeira);
  let segunda = null;
  const erroServidor = texto === null ? erroDoServidor(primeira) : null;
  if (texto === null && primeira.conversationId && !erroServidor) {
    segunda = await rodarAgy(agyBin, argsAgy({ ...comuns, prompt: PROMPT_RETOMADA, retomar: primeira.conversationId, printTimeoutS: 210 }), { maxTools: 5, timeoutMs: 180_000, cwd });
    texto = respostaUtil(segunda);
  }
  return { primeira, segunda, texto, erroServidor };
}

// ------------------------------------------------------------------------------------------------- saídas
function resumoParcial(nome, execs) {
  const linhas = [`# Resultado parcial (${nome})`, ''];
  execs.filter(Boolean).forEach((e, i) => {
    linhas.push(`## Execução ${i + 1}: ${e.motivo ? `encerrada por ${e.motivo}` : 'terminou sem resposta'}`);
    if (e.encerradoEmMs !== undefined) linhas.push(`- encerramento pedido aos ${Math.round(e.encerradoEmMs / 1000)} s; o agy saiu aos ${Math.round(e.duracaoMs / 1000)} s`);
    linhas.push(`- turnos: ${e.turnos}, ferramentas: ${e.ferramentas.length} (fora de escopo: ${e.foraDeEscopo}), duração: ${Math.round(e.duracaoMs / 1000)} s`);
    if (e.resultado?.error) linhas.push(`- erro do agy: ${e.resultado.error}`);
    if (e.stderr.trim()) linhas.push(`- stderr: ${e.stderr.trim().split('\n').slice(-3).join(' | ')}`);
    const lidos = e.ferramentas.map((f) => f.parametros?.Path ?? f.parametros?.path ?? f.nome).filter(Boolean);
    if (lidos.length) linhas.push('- ferramentas chamadas (em ordem):', ...lidos.slice(0, 60).map((l) => `  - ${l}`));
    linhas.push('');
  });
  return linhas.join('\n');
}

export function gravarMetrica(outDir, linha) {
  appendFileSync(join(outDir, 'metricas.jsonl'), `${JSON.stringify(linha)}\n`);
}

function travar(outDir) {
  const trava = join(outDir, '.revisar-agy.lock');
  if (existsSync(trava)) {
    const pid = Number(readFileSync(trava, 'utf8'));
    let vivo = false;
    try {
      process.kill(pid, 0);
      vivo = true;
    } catch {
      /* processo morto: trava velha */
    }
    if (vivo) throw new Error(`já existe uma revisão do agy em andamento (pid ${pid}); uma por vez por causa da cota`);
    rmSync(trava, { force: true });
  }
  writeFileSync(trava, String(process.pid), { flag: 'wx' });
  return () => rmSync(trava, { force: true });
}

// ----------------------------------------------------------------------------------------------- principal
export async function principal(argv = process.argv.slice(2), env = process.env) {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const opcoes = lerArgumentos(argv);
  const raiz = resolve(opcoes.raiz ?? join(aqui, '..'));
  const outDir = resolve(opcoes.out ?? join(raiz, '.revisao-agy'));
  mkdirSync(outDir, { recursive: true });

  let agyBin = null;
  if (!opcoes.dryRun) {
    agyBin = descobrirAgy(env);
    if (!agyBin) throw new Error('agy não encontrado (defina AGY_BIN ou ponha o agy no PATH)');
  }
  const destravar = opcoes.dryRun ? () => {} : travar(outDir);
  let falhou = false;
  try {
    // Saída estruturada (--json-schema) só com o prompt simples; o prompt do revisor responde em markdown.
    const schemaArq = opcoes.schema && !opcoes.promptRevisor ? join(outDir, 'schema.json') : null;
    if (schemaArq) writeFileSync(schemaArq, JSON.stringify(SCHEMA, null, 2));

    // Pacotes a revisar: um já pronto (--pacote, para comparar modelos com a mesma entrada) ou montados do git.
    const itens = [];
    if (opcoes.pacote) {
      const arquivoPacote = resolve(opcoes.pacote);
      itens.push({ nome: basename(arquivoPacote, '.md').replace(/^pacote-/, ''), arquivoPacote, arquivos: 0, kb: Math.round(statSync(arquivoPacote).size / 1024) });
    } else {
      for (const r of opcoes.repos) {
        const repo = resolve(raiz, r);
        const rotulo = r === '.' ? 'repo' : r.replace(/[^A-Za-z0-9_-]+/g, '_');
        const mudancas = coletarMudancas(repo, opcoes.base);
        if (mudancas.porArquivo.size === 0) {
          console.log(`[${rotulo}] nada para revisar`);
          continue;
        }
        for (const pacote of montarPacotes({ repo, raiz, mudancas })) {
          const nome = [rotulo, pacote.nome].filter(Boolean).join('-');
          const arquivoPacote = join(outDir, `pacote-${nome}.md`);
          writeFileSync(arquivoPacote, pacote.texto);
          itens.push({ nome, arquivoPacote, arquivos: pacote.arquivos.length, kb: Math.round(Buffer.byteLength(pacote.texto) / 1024) });
        }
      }
    }

    for (const { nome, arquivoPacote, arquivos, kb } of itens) {
      console.log(`[${nome}] pacote: ${arquivos} arquivo(s), ${kb} KB -> ${arquivoPacote}`);
      if (opcoes.dryRun) continue;

      const t0 = Date.now();
      const { primeira, segunda, texto, erroServidor } = await revisarPacote({ agyBin, cwd: raiz, opcoes, outDir, schemaArq, arquivoPacote });
      const execs = [primeira, segunda].filter(Boolean);
      // Evento `result` bruto, com ou sem sucesso: se a saída vier num campo inesperado, o diagnóstico está aqui.
      writeFileSync(join(outDir, `resultado-${nome}.json`), JSON.stringify(execs.map((e) => e.resultado ?? { semResultado: true, motivo: e.motivo, stderr: e.stderr }), null, 2));
      const usage = (e) => e?.resultado?.usage?.total_tokens ?? 0;
      gravarMetrica(outDir, {
        quando: new Date().toISOString(), nome, modelo: opcoes.model, arquivos, pacoteKB: kb,
        segundos: Math.round((Date.now() - t0) / 1000), turnos: execs.reduce((s, e) => s + e.turnos, 0),
        ferramentas: execs.reduce((s, e) => s + e.ferramentas.length, 0), foraDeEscopo: execs.reduce((s, e) => s + e.foraDeEscopo, 0), retomada: Boolean(segunda),
        turnoMedioSeg: Math.round(execs.flatMap((e) => e.latenciasTurno).reduce((s, v, _, a) => s + v / a.length, 0)),
        turnoMaxSeg: Math.round(Math.max(0, ...execs.flatMap((e) => e.latenciasTurno))),
        tokens: execs.reduce((s, e) => s + usage(e), 0), desfecho: texto !== null ? 'ok' : erroServidor ? 'erro-do-servidor' : 'sem-resposta',
        motivo: execs.map((e) => e.motivo).filter(Boolean).join(','),
      });
      if (texto === null) {
        falhou = true;
        const parcial = join(outDir, `parcial-${nome}.md`);
        writeFileSync(parcial, resumoParcial(nome, execs));
        console.error(erroServidor
          ? `[${nome}] o servidor do agy recusou: ${erroServidor.slice(0, 160)}. Não houve retomada (não adianta); tente mais tarde. Resumo em ${parcial}`
          : `[${nome}] SEM RESPOSTA do agy; resumo do que ele fez em ${parcial}`);
        continue;
      }
      const achados = extrairJson(texto);
      writeFileSync(join(outDir, `achados-${nome}.json`), JSON.stringify(achados ?? { texto }, null, 2));
      writeFileSync(join(outDir, `achados-${nome}.md`), formatarAchados(achados, texto));
      console.log(`[${nome}] ok em ${Math.round((Date.now() - t0) / 1000)} s -> ${join(outDir, `achados-${nome}.md`)}`);
    }
  } finally {
    destravar();
  }
  return falhou ? 2 : 0;
}

export function formatarAchados(achados, textoOriginal) {
  if (!achados || !Array.isArray(achados.achados)) return `${textoOriginal}\n`;
  if (achados.achados.length === 0) return 'Nenhum achado.\n';
  return achados.achados.map((a, i) => `${i + 1}. [${a.severidade}] ${a.arquivo}:${a.linha}\n   ${a.cenario}`).join('\n\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().then((c) => process.exit(c), (e) => {
    console.error(`erro: ${e.message}`);
    process.exit(3);
  });
}
