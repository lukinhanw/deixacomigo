// Testes do revisar-agy.mjs: só o que tem lógica (coleta, pacote, divisão, orçamento e retomada).
// Rodar: node --test tools/revisar-agy.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  conteudoParaPacote, coletarMudancas, dividirDiff, dividirEmBlocos, extrairJson, montarPacotes, patchArquivoNovo,
  lerArgumentos, montarPromptRevisor, principal, respostaUtil, revisarPacote, rodarAgy,
} from './revisar-agy.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'revisar-agy-'));
const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

function repoComMudancas() {
  const dir = tmp();
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.invalid');
  git(dir, 'config', 'user.name', 'T');
  writeFileSync(join(dir, 'a.php'), '<?php\n$a = 1;\n$b = 2;\n');
  writeFileSync(join(dir, 'composer.lock'), '{}\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  writeFileSync(join(dir, 'a.php'), '<?php\n$a = 1;\n$b = 3;\n');
  writeFileSync(join(dir, 'composer.lock'), '{"x":1}\n');
  writeFileSync(join(dir, 'novo.php'), '<?php\necho 1;\n');
  mkdirSync(join(dir, 'vendor'));
  writeFileSync(join(dir, 'vendor', 'x.php'), '<?php\n');
  return dir;
}

test('coleta mudanças rastreadas e arquivos novos sem tocar o índice', () => {
  const dir = repoComMudancas();
  const antes = git(dir, 'status', '--porcelain').stdout;
  const { porArquivo } = coletarMudancas(dir);
  assert.deepEqual([...porArquivo.keys()].sort(), ['a.php', 'novo.php']); // lock e vendor ficam de fora
  assert.match(porArquivo.get('a.php'), /\+\$b = 3;/);
  assert.match(porArquivo.get('novo.php'), /--- \/dev\/null\n\+\+\+ b\/novo\.php\n@@ -0,0 \+1,2 @@\n\+<\?php\n\+echo 1;/);
  assert.equal(git(dir, 'status', '--porcelain').stdout, antes);
  assert.equal(git(dir, 'diff', '--cached', '--name-only').stdout, '');
});

test('patch de arquivo novo e divisão do diff por arquivo', () => {
  const patch = patchArquivoNovo('x/y.js', 'a\nb\n');
  assert.equal(dividirDiff(patch + patch.replaceAll('x/y.js', 'z.js')).size, 2);
});

test('conteúdo: inteiro com números de linha até o limite; acima, janelas fundidas ao redor dos trechos', () => {
  assert.equal(conteudoParaPacote('um\ndois\n', '', 600, 60), '1: um\n2: dois');
  const linhas = Array.from({ length: 1000 }, (_, i) => `l${i + 1}`).join('\n');
  const patch = '@@ -100,1 +100,1 @@\n@@ -110,1 +110,1 @@\n@@ -900,1 +900,1 @@\n';
  const out = conteudoParaPacote(linhas, patch, 600, 10);
  assert.match(out, /só trechos/);
  assert.match(out, /90: l90[\s\S]*120: l120\n\.\.\.\n890: l890/); // 100 e 110 fundem; 900 fica à parte
  assert.doesNotMatch(out, /\n500: /);
});

test('blocos respeitam o teto e agrupam por diretório', () => {
  const blocos = dividirEmBlocos([['app/a.php', 60], ['app/b.php', 60], ['tests/c.php', 60], ['routes/d.php', 10]], 100);
  assert.ok(blocos.every((b) => b.length >= 1));
  assert.equal(blocos.flat().length, 4);
  const bytes = (b) => b.reduce((s, c) => s + { 'app/a.php': 60, 'app/b.php': 60, 'tests/c.php': 60, 'routes/d.php': 10 }[c], 0);
  assert.ok(blocos.every((b) => b.length === 1 || bytes(b) <= 100));
});

test('pacote traz contexto, falsos positivos, diff e conteúdo atual', () => {
  const dir = repoComMudancas();
  const raiz = tmp();
  mkdirSync(join(raiz, 'tools'), { recursive: true });
  mkdirSync(join(raiz, '.claude', 'skills', 'revisao'), { recursive: true });
  writeFileSync(join(raiz, 'tools', 'revisao-contexto.md'), 'CONTEXTO-DO-PROJETO');
  writeFileSync(join(raiz, '.claude', 'skills', 'revisao', 'SKILL.md'), '## Falsos positivos\n- agy: "soft delete em contatos". Falso.\n- codex: outro\n');
  const [pacote, ...resto] = montarPacotes({ repo: dir, raiz, mudancas: coletarMudancas(dir) });
  assert.equal(resto.length, 0);
  for (const trecho of ['CONTEXTO-DO-PROJETO', 'soft delete em contatos', '+$b = 3;', '## novo.php\n1: <?php']) assert.ok(pacote.texto.includes(trecho), trecho);
  assert.ok(!pacote.texto.includes('outro'));
});

// ------------------------------------------------------------------------------------------ agy falso
function agyFalso(dir) {
  const arq = join(dir, 'agy-falso.mjs');
  writeFileSync(arq, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
const modo = process.env.FAKE_MODO;
const retoma = args.includes('--conversation');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const tool = (i) => out({ event: 'step_update', step_update: { conversation_id: 'conv-1', step_index: i, state: 'ACTIVE', step_type: 'tool', tool_name: 'read_file', tool_info: { parameters: { Path: '/x/' + i } } } });
out({ event: 'init', conversation_id: 'conv-1', init: {} });
if (modo === 'ok' || (modo === 'loop-depois-ok' && retoma)) {
  tool(1); tool(2);
  out({ event: 'step_update', step_update: { step_index: 3, state: 'DONE', step_type: 'agent_response' } });
  out({ event: 'result', result: { conversation_id: 'conv-1', status: 'SUCCESS', response: '{"achados":[]}', usage: { total_tokens: 123 } } });
  process.exit(0);
} else if (modo === 'capacidade') {
  out({ event: 'result', result: { conversation_id: 'conv-1', status: 'ERROR', response: '', error: 'API error (attempt 2): UNAVAILABLE (code 503): No capacity available for model x on the server' } });
  process.exit(3);
} else if (modo === 'vazio') {
  out({ event: 'result', result: { conversation_id: 'conv-1', status: 'ERROR', response: '', error: 'print timeout' } });
  process.exit(3);
} else if (modo === 'loop' || modo === 'loop-depois-ok') {
  for (let i = 1; i <= 100; i++) tool(i);
  setTimeout(() => {}, 60000);
} else if (modo === 'teimoso') {
  // como o agy real: captura o SIGTERM ("interrupted") e continua vivo; só o SIGKILL encerra
  process.on('SIGTERM', () => process.stderr.write('error: interrupted\\n'));
  setTimeout(() => {}, 60000);
} else if (modo === 'neto-outra-sessao') {
  // filho em outra sessão (setsid): o encerramento do grupo não o alcança e ele segura o stdout
  const { spawn } = await import('node:child_process');
  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true }).unref();
  setTimeout(() => {}, 60000);
} else if (modo === 'neto') {
  // filho que herda o stdout e sobrevive ao pai: sem matar o grupo, o 'close' demoraria 30 s
  const { spawn } = await import('node:child_process');
  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
  setTimeout(() => {}, 60000);
} else { setTimeout(() => {}, 60000); }
`);
  chmodSync(arq, 0o755);
  return arq;
}

test('rodarAgy: resposta normal conta ferramentas e devolve o resultado', async () => {
  process.env.FAKE_MODO = 'ok';
  const r = await rodarAgy(agyFalso(tmp()), [], { maxTools: 25, timeoutMs: 10_000, cwd: tmpdir() });
  assert.equal(r.motivo, null);
  assert.equal(r.ferramentas.length, 2);
  assert.equal(r.turnos, 1);
  assert.equal(r.foraDeEscopo, 0);
  assert.equal(r.conversationId, 'conv-1');
  assert.equal(respostaUtil(r), '{"achados":[]}');
});

test('rodarAgy: estourar o orçamento de ferramentas encerra o agy', async () => {
  process.env.FAKE_MODO = 'loop';
  const r = await rodarAgy(agyFalso(tmp()), [], { maxTools: 5, timeoutMs: 20_000, cwd: tmpdir() });
  assert.equal(r.motivo, 'ferramentas');
  assert.equal(respostaUtil(r), null);
  assert.ok(r.duracaoMs < 15_000);
});

test('rodarAgy: estourar o tempo encerra o agy', async () => {
  process.env.FAKE_MODO = 'mudo';
  const r = await rodarAgy(agyFalso(tmp()), [], { maxTools: 25, timeoutMs: 400, cwd: tmpdir() });
  assert.equal(r.motivo, 'tempo');
});

test('rodarAgy: encerra também os processos filhos do agy (não espera o stdout deles fechar)', async () => {
  process.env.FAKE_MODO = 'neto';
  const r = await rodarAgy(agyFalso(tmp()), [], { maxTools: 25, timeoutMs: 400, cwd: tmpdir() });
  assert.equal(r.motivo, 'tempo');
  assert.ok(r.duracaoMs < 10_000, `demorou ${r.duracaoMs} ms`);
});

test('rodarAgy: não espera o stdout de um filho em outra sessão fechar', async () => {
  process.env.FAKE_MODO = 'neto-outra-sessao';
  const r = await rodarAgy(agyFalso(tmp()), [], { maxTools: 25, timeoutMs: 400, cwd: tmpdir() });
  assert.equal(r.motivo, 'tempo');
  assert.ok(r.duracaoMs < 10_000, `demorou ${r.duracaoMs} ms`);
});

test('rodarAgy: agy que ignora o SIGTERM é morto com SIGKILL logo depois', async () => {
  process.env.FAKE_MODO = 'teimoso';
  const r = await rodarAgy(agyFalso(tmp()), [], { maxTools: 25, timeoutMs: 400, cwd: tmpdir() });
  assert.equal(r.motivo, 'tempo');
  // Limites folgados de propósito: o que se prova é que o SIGKILL chega em poucos segundos (e não aos 60 s do agy
  // teimoso), mesmo com a máquina ocupada; limites apertados quebravam de vez em quando.
  assert.ok(r.duracaoMs < 20_000, `demorou ${r.duracaoMs} ms`);
  assert.ok(r.encerradoEmMs >= 400 && r.encerradoEmMs < 5000, `encerrado em ${r.encerradoEmMs} ms`);
});

test('revisarPacote: laço de ferramentas vira uma retomada que entrega o resultado', async () => {
  const dir = tmp();
  process.env.FAKE_MODO = 'loop-depois-ok';
  process.env.FAKE_LOG = join(dir, 'chamadas.log');
  const r = await revisarPacote({ agyBin: agyFalso(dir), cwd: tmpdir(), opcoes: { maxTools: 5, timeout: 20, model: 'm', effort: 'e' }, outDir: dir, schemaArq: null, arquivoPacote: join(dir, 'p.md') });
  assert.equal(r.texto, '{"achados":[]}');
  assert.ok(r.segunda);
  const chamadas = readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(chamadas.length, 2);
  assert.ok(chamadas[1].includes('--conversation') && chamadas[1].includes('conv-1'));
  assert.ok(!chamadas[0].includes('--dangerously-skip-permissions'));
});

test('revisarPacote: sem resposta nem na retomada faz só uma retomada e devolve null', async () => {
  const dir = tmp();
  process.env.FAKE_MODO = 'vazio';
  process.env.FAKE_LOG = join(dir, 'chamadas.log');
  const r = await revisarPacote({ agyBin: agyFalso(dir), cwd: tmpdir(), opcoes: { maxTools: 5, timeout: 20, model: 'm', effort: 'e' }, outDir: dir, schemaArq: null, arquivoPacote: join(dir, 'p.md') });
  assert.equal(r.texto, null);
  assert.equal(readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n').length, 2);
});

test('revisarPacote: erro de capacidade do servidor não gera retomada', async () => {
  const dir = tmp();
  process.env.FAKE_MODO = 'capacidade';
  process.env.FAKE_LOG = join(dir, 'chamadas.log');
  const r = await revisarPacote({ agyBin: agyFalso(dir), cwd: tmpdir(), opcoes: { maxTools: 5, timeout: 20, model: 'm', effort: 'e' }, outDir: dir, schemaArq: null, arquivoPacote: join(dir, 'p.md') });
  assert.equal(r.texto, null);
  assert.equal(r.segunda, null);
  assert.match(r.erroServidor, /503/);
  assert.equal(readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n').length, 1);
});

test('caminho de sucesso: principal chama o agy, grava achados e o resultado bruto', async () => {
  const dir = repoComMudancas();
  const raiz = tmp();
  const out = join(raiz, 'saida');
  process.env.FAKE_MODO = 'ok';
  const antes = process.env.AGY_BIN;
  process.env.AGY_BIN = agyFalso(tmp());
  try {
    assert.equal(await principal(['--repo', dir, '--raiz', raiz, '--out', out, '--timeout', '20', '--prompt-simples']), 0);
  } finally {
    if (antes === undefined) delete process.env.AGY_BIN;
    else process.env.AGY_BIN = antes;
  }
  const nome = dir.replace(/[^A-Za-z0-9_-]+/g, '_');
  assert.equal(readFileSync(join(out, `achados-${nome}.md`), 'utf8'), 'Nenhum achado.\n');
  assert.equal(JSON.parse(readFileSync(join(out, `resultado-${nome}.json`), 'utf8'))[0].status, 'SUCCESS');
  const metrica = JSON.parse(readFileSync(join(out, 'metricas.jsonl'), 'utf8').trim());
  assert.equal(metrica.desfecho, 'ok');
  assert.equal(metrica.ferramentas, 2);
});

test('resposta estruturada como objeto também conta como resposta', () => {
  assert.equal(respostaUtil({ resultado: { status: 'SUCCESS', response: { achados: [] } } }), '{"achados":[]}');
  assert.equal(respostaUtil({ resultado: { status: 'SUCCESS', response: '' } }), null);
});

test('principal --dry-run grava o pacote e não chama o agy; json inválido vira texto', async () => {
  const dir = repoComMudancas();
  const raiz = tmp();
  const out = join(raiz, 'saida');
  const codigo = await principal(['--repo', dir, '--raiz', raiz, '--out', out, '--dry-run']);
  assert.equal(codigo, 0);
  assert.match(readFileSync(join(out, `pacote-${dir.replace(/[^A-Za-z0-9_-]+/g, '_')}.md`), 'utf8'), /\+\$b = 3;/);
  assert.deepEqual(extrairJson('texto antes {"achados":[]} depois'), { achados: [] });
  assert.equal(extrairJson('sem json'), null);
});

test('padrões: agy com Hydrogen medium e o prompt do revisor; --prompt-simples volta ao prompt curto', () => {
  const o = lerArgumentos([]);
  assert.deepEqual([o.model, o.promptRevisor, o.maxTools, o.repos], ['gemini-4-hydrogen-medium', true, 25, ['.']]);
  assert.equal(lerArgumentos(['--prompt-simples']).promptRevisor, false);
  assert.throws(() => lerArgumentos(['--motor', 'proxy']), /argumento desconhecido/);
});

test('--pacote revisa um pacote pronto com o prompt do revisor.md (padrão), sem git', async () => {
  const raiz = tmp();
  mkdirSync(join(raiz, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(raiz, '.claude', 'agents', 'revisor.md'), '---\nname: revisor\nmodel: sonnet\n---\n\nCORPO-DO-REVISOR\n');
  const out = join(raiz, 'saida');
  mkdirSync(out, { recursive: true });
  const pacote = join(out, 'pacote-meu.md');
  writeFileSync(pacote, '# pacote pronto');
  const prompt = montarPromptRevisor(raiz, pacote);
  assert.match(prompt, new RegExp(`^O pacote de revisão está em ${pacote}[\\s\\S]*CORPO-DO-REVISOR$`));
  assert.ok(!prompt.includes('name: revisor'));

  process.env.FAKE_MODO = 'ok';
  const dir = tmp();
  process.env.FAKE_LOG = join(dir, 'chamadas.log');
  const antes = process.env.AGY_BIN;
  process.env.AGY_BIN = agyFalso(dir);
  try {
    assert.equal(await principal(['--raiz', raiz, '--out', out, '--pacote', pacote, '--timeout', '20']), 0);
  } finally {
    if (antes === undefined) delete process.env.AGY_BIN;
    else process.env.AGY_BIN = antes;
  }
  const chamada = JSON.parse(readFileSync(process.env.FAKE_LOG, 'utf8').trim());
  assert.match(chamada[1], /CORPO-DO-REVISOR/);
  assert.equal(chamada[chamada.indexOf('--model') + 1], 'gemini-4-hydrogen-medium');
  assert.ok(!chamada.includes('--json-schema'), 'com o prompt do revisor a resposta é markdown, sem schema');
  assert.match(readFileSync(join(out, 'metricas.jsonl'), 'utf8'), /gemini-4-hydrogen-medium/);
});
