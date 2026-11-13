#!/usr/bin/env node
// deixacomigo: parte determinística da instalação (Node puro, sem dependências, idempotente).
// Uso: node instalar.mjs [pasta-do-projeto]   (padrão: a pasta atual)
// Nunca sobrescreve arquivo existente. Imprime um resumo em JSON no fim (o agente lê e continua).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const proj = resolve(process.argv[2] ?? process.cwd());
const win = process.platform === 'win32';
const resumo = { projeto: proj, copiados: [], pulados: [], avisos: [], erros: [], placeholders: [], grafo: null, modelos: {} };
const log = (m) => console.error(`[deixacomigo] ${m}`);

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: proj, encoding: 'utf8', shell: false, ...opts });
const tem = (cmd, args = ['--version']) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: win }); // win: acha os .cmd/.ps1 do npm
  return !r.error && r.status === 0;
};

// 1. Pré-requisitos
if (!existsSync(proj) || !statSync(proj).isDirectory()) fim(`pasta não existe: ${proj}`);
if (!existsSync(join(proj, '.git'))) fim('o projeto precisa ser um repositório git (git init) antes de instalar');
const python = ['python', 'python3', 'py'].find((p) => tem(p));
if (!python) fim('python não encontrado (o graphify precisa de Python 3 + pip)');
if (!tem('git')) fim('git não encontrado');
if (!tem('agy', ['--help']) && !existsSync(join(process.env.LOCALAPPDATA ?? '', 'agy', 'bin')))
  resumo.avisos.push('agy não encontrado: a revisão pelo Antigravity fica de fora');

// 2. graphify: instala o pacote e descobre o caminho do executável
log('instalando/atualizando o graphify (pip)…');
const pip = run(python, ['-m', 'pip', 'install', '--user', '--upgrade', '--quiet', 'graphifyy']);
if (pip.status !== 0) fim(`pip install graphifyy falhou: ${(pip.stderr || '').slice(0, 300)}`);
const esquema = win ? 'nt_user' : 'posix_user';
const scripts = run(python, ['-c', `import sysconfig;print(sysconfig.get_path("scripts","${esquema}"))`]).stdout.trim();
const gExe = [join(scripts, win ? 'graphify.exe' : 'graphify'), join(scripts, 'graphify')].find(existsSync);
if (!gExe) fim(`executável do graphify não encontrado em ${scripts}`);
const gBin = gExe.replace(/\\/g, '/');
const gDir = dirname(gBin);
const g = (args) => run(gExe, args);

// 3. Copiar modelo/ sem sobrescrever
function copiar(origem, destino) {
  for (const nome of readdirSync(origem)) {
    const o = join(origem, nome);
    const d = join(destino, nome);
    if (statSync(o).isDirectory()) {
      mkdirSync(d, { recursive: true });
      copiar(o, d);
    } else if (existsSync(d)) {
      resumo.pulados.push(relative(proj, d).replace(/\\/g, '/'));
    } else {
      cpSync(o, d);
      resumo.copiados.push(relative(proj, d).replace(/\\/g, '/'));
    }
  }
}
copiar(join(aqui, 'modelo'), proj);

// Arquivos que o projeto já tinha (pulados) com as regras antigas de revisão: o instalador não os
// sobrescreve, então avisa para o agente mesclar (INSTALAR.md, passo 2). Senão sobram regras que se
// contradizem (ex.: "nunca usar o Codex com modelos da OpenAI") com o hook e a skill novos.
for (const rel of ['CLAUDE.md', '.claude/skills/revisao/SKILL.md']) {
  if (resumo.pulados.includes(rel) && /nunca usar o Codex/i.test(readFileSync(join(proj, rel), 'utf8')))
    resumo.avisos.push(`${rel} é de uma versão antiga do kit (Codex só com DeepSeek): mescle com modelo/${rel} (INSTALAR.md, passo 2)`);
}

// CLAUDE.md e agentes recém-copiados: gravam o caminho real do graphify
for (const rel of resumo.copiados.filter((c) => c === 'CLAUDE.md' || /^\.claude\/agents\/.+\.md$/.test(c))) {
  const arq = join(proj, rel);
  writeFileSync(arq, readFileSync(arq, 'utf8').replaceAll('__GRAPHIFY_BIN__', gDir));
}

// 4. .gitignore
const gi = join(proj, '.gitignore');
let giTxt = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
const linhas = giTxt.split(/\r?\n/).map((l) => l.trim());
const falta = ['.env.local', '.claude/settings.local.json', 'graphify-out/', '.revisao-agy/'].filter((l) => !linhas.includes(l));
if (falta.length) {
  if (giTxt && !giTxt.endsWith('\n')) giTxt += '\n';
  writeFileSync(gi, `${giTxt}\n# deixacomigo\n${falta.join('\n')}\n`);
  resumo.copiados.push(`.gitignore (+${falta.join(', ')})`);
}

// 5. graphify: skill, grafo, hooks
log('instalando a skill do graphify e gerando o grafo (só código, sem LLM)…');
g(['install', '--platform', 'claude']);
const ext = g(['extract', '.', '--code-only']);
if (ext.status !== 0) resumo.erros.push(`graphify extract falhou: ${(ext.stderr || ext.stdout || '').slice(-300)}`);
else {
  g(['cluster-only', '.', '--no-label']);
  const m = /(\d+) nodes, (\d+) edges, (\d+) communities/.exec(`${ext.stdout}${ext.stderr}`);
  if (m) resumo.grafo = { nos: +m[1], arestas: +m[2], comunidades: +m[3] };
}

// Hooks do graphify vão para .claude/settings.local.json (fora do git: têm o caminho desta máquina).
// Não usamos `graphify claude install`: ele grava em settings.json (versionado) e no CLAUDE.md em inglês.
const local = join(proj, '.claude', 'settings.local.json');
mkdirSync(dirname(local), { recursive: true });
let cfg = {};
if (existsSync(local)) {
  try { cfg = JSON.parse(readFileSync(local, 'utf8')); }
  catch { fim('.claude/settings.local.json existe mas não é JSON válido; corrija e rode de novo'); }
}
cfg.hooks ??= {};
const garante = (evento, matcher, comando, timeout) => {
  const lista = (cfg.hooks[evento] ??= []);
  const ja = lista.some((e) => (e.hooks ?? []).some((h) => h.command === comando));
  if (ja) return;
  const entrada = { hooks: [{ type: 'command', command: comando, timeout }] };
  if (matcher) entrada.matcher = matcher;
  lista.push(entrada);
};
garante('PreToolUse', 'Bash|Grep', `${gBin} hook-guard search`, 10);
garante('PreToolUse', 'Read|Glob', `${gBin} hook-guard read`, 10);
// Graphify primeiro: bloqueia a primeira exploração de código da sessão até haver uma consulta ao grafo
// (`marca` registra a consulta, `exige` bloqueia). Só atua em projeto com graphify-out/graph.json.
if (existsSync(join(proj, '.claude', 'hooks', 'graphify-primeiro.py'))) {
  const gp = `${python} "$CLAUDE_PROJECT_DIR/.claude/hooks/graphify-primeiro.py"`;
  garante('PreToolUse', 'Bash', `${gp} marca`, 5);
  garante('PreToolUse', 'Read|Grep|Glob|Bash', `${gp} exige`, 5);
}
// Stop: o `cd` evita um graphify-out aninhado quando o cwd da sessão está numa subpasta.
// Projetos instalados antes gravaram `graphify update .` sem o `cd`: troca pela forma nova.
const stopAntigo = `${gBin} update .`;
if (Array.isArray(cfg.hooks.Stop)) {
  cfg.hooks.Stop = cfg.hooks.Stop
    .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => h.command !== stopAntigo) }))
    .filter((e) => e.hooks.length);
}
garante('Stop', null, `cd "$CLAUDE_PROJECT_DIR" && ${gBin} update .`, 60);
// SessionStart: informa o revisor externo da sessão (variável REVISOR; sem ela o Claude pergunta).
if (existsSync(join(proj, '.claude', 'hooks', 'revisor-sessao.sh')))
  garante('SessionStart', 'startup|clear', 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/revisor-sessao.sh"', 5);
// Modelo da sessão e consultor: só grava se o projeto ainda não definiu.
for (const [chave, valor] of [['model', 'sonnet'], ['advisorModel', 'opus']]) {
  if (cfg[chave] === undefined) { cfg[chave] = valor; resumo.modelos[chave] = `gravado (${valor})`; }
  else resumo.modelos[chave] = `mantido (${cfg[chave]})`;
}
// Revisor da sessão: agy por padrão (sonnet de reserva). O hook revisor-sessao.sh lê REVISOR; sem ele o Claude perguntaria.
cfg.env ??= {};
if (cfg.env.REVISOR === undefined) { cfg.env.REVISOR = 'agy'; resumo.modelos.REVISOR = 'gravado (agy)'; }
else resumo.modelos.REVISOR = `mantido (${cfg.env.REVISOR})`;
const novo = JSON.stringify(cfg, null, 2) + '\n';
if (!existsSync(local) || readFileSync(local, 'utf8') !== novo) {
  writeFileSync(local, novo);
  resumo.copiados.push('.claude/settings.local.json (hooks do graphify e do revisor, modelo e consultor, mesclados)');
}

// 6. Skill global "deixacomigo" para o gatilho "ativar o deixacomigo"
const skillDest = join(homedir(), '.claude', 'skills', 'deixacomigo');
mkdirSync(skillDest, { recursive: true });
cpSync(join(aqui, 'skill', 'deixacomigo', 'SKILL.md'), join(skillDest, 'SKILL.md'));

// 7. Placeholders que o agente ainda precisa preencher
const varre = (dir) => {
  for (const nome of readdirSync(dir)) {
    if (['node_modules', '.git', 'graphify-out'].includes(nome)) continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) varre(p);
    else if (/\.(md|mjs|sh)$|^\.graphifyignore$/.test(nome) && /PREENCHER/.test(readFileSync(p, 'utf8')))
      resumo.placeholders.push(relative(proj, p).replace(/\\/g, '/'));
  }
};
for (const alvo of ['CLAUDE.md', 'tools', '.claude/skills', '.claude/agents', '.graphifyignore']) {
  const p = join(proj, alvo);
  if (!existsSync(p)) continue;
  if (statSync(p).isDirectory()) varre(p);
  else if (/PREENCHER/.test(readFileSync(p, 'utf8'))) resumo.placeholders.push(alvo);
}
resumo.graphifyBin = gBin;
resumo.graphifyDir = gDir;
console.log(JSON.stringify(resumo, null, 2));

function fim(msg) {
  console.log(JSON.stringify({ ...resumo, erros: [...resumo.erros, msg] }, null, 2));
  process.exit(1);
}
