// Jarvis — assistente de voz local para o seu Vault
// Sem dependências: requer apenas Node.js 18+
// Uso: node server.js   ->  http://localhost:3333

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'jarvis.config.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3333);
const HOST = process.env.HOST || '127.0.0.1';

const DEFAULT_CONFIG = {
  nome: 'Jarvis',
  tratamento: 'senhor',
  personalidade: 'Educado, direto e com leve humor britânico. Respostas curtas, pensadas para serem faladas em voz alta.',
  idioma: 'pt-BR',
  vaultPath: path.join(ROOT, 'vault-exemplo'),
  provedor: 'anthropic', // anthropic | openai
  modelo: 'claude-sonnet-4-5',
  anthropicKey: '',
  openaiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  voz: { motor: 'navegador', nomeVoz: '', velocidade: 1.05, tom: 0.9, elevenlabsKey: '', elevenlabsVoiceId: '', openaiVoz: 'onyx' },
  palavraDeAtivacao: true,
  permitirComandos: false,
  maxPassos: 12,
};

// ---------- Config ----------
function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
  }
  return out;
}
function loadConfig() {
  let cfg = DEFAULT_CONFIG;
  try { cfg = deepMerge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))); } catch {}
  if (process.env.ANTHROPIC_API_KEY && !cfg.anthropicKey) cfg.anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY && !cfg.openaiKey) cfg.openaiKey = process.env.OPENAI_API_KEY;
  if (process.env.JARVIS_VAULT) cfg.vaultPath = process.env.JARVIS_VAULT;
  return cfg;
}
let config = loadConfig();
function saveConfig(c) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2)); config = loadConfig(); }
function mask(k) { return k ? '••••' + k.slice(-4) : ''; }
function publicConfig() {
  const c = JSON.parse(JSON.stringify(config));
  c.anthropicKey = mask(c.anthropicKey); c.openaiKey = mask(c.openaiKey); c.voz.elevenlabsKey = mask(c.voz.elevenlabsKey);
  return c;
}

// ---------- Vault helpers ----------
function vault() { return path.resolve(config.vaultPath); }
function safe(rel = '') {
  const p = path.resolve(vault(), String(rel).replace(/^[/\\]+/, ''));
  if (p !== vault() && !p.startsWith(vault() + path.sep)) throw new Error('Caminho fora do Vault: ' + rel);
  return p;
}
const jarvisDir = () => safe('.jarvis');
const IGNORE = new Set(['node_modules', '.git', '.DS_Store', '.obsidian', '.trash']);

async function tree(rel = '', mostrarOcultos = false, depth = 0) {
  const abs = safe(rel);
  const items = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const d of items.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))) {
    if (IGNORE.has(d.name)) continue;
    if (!mostrarOcultos && d.name.startsWith('.')) continue;
    const r = path.posix.join(rel.split(path.sep).join('/'), d.name);
    if (d.isDirectory()) out.push({ nome: d.name, caminho: r, tipo: 'pasta', filhos: depth < 6 ? await tree(r, mostrarOcultos, depth + 1) : [] });
    else out.push({ nome: d.name, caminho: r, tipo: 'arquivo' });
  }
  return out;
}

async function walkFiles(dir, acc = [], limit = 3000) {
  const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const d of items) {
    if (IGNORE.has(d.name) || acc.length >= limit) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await walkFiles(p, acc, limit); else acc.push(p);
  }
  return acc;
}
const rel = (abs) => path.relative(vault(), abs).split(path.sep).join('/');
const TEXT_EXT = /\.(md|txt|json|csv|tsv|js|ts|py|sh|html|css|yml|yaml|toml|env|ini|xml|log|sql|jsx|tsx)$|^\.env/i;

// ---------- Skills, comandos, memória, tarefas ----------
async function listSkills() {
  const dir = path.join(jarvisDir(), 'skills');
  const out = [];
  for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    let file = d.isDirectory() ? path.join(dir, d.name, 'SKILL.md') : d.name.endsWith('.md') ? path.join(dir, d.name) : null;
    if (!file || !fs.existsSync(file)) continue;
    const txt = await fsp.readFile(file, 'utf8');
    const m = txt.match(/^---[\s\S]*?description:\s*(.+?)\n[\s\S]*?---/);
    out.push({ nome: d.name.replace(/\.md$/, ''), descricao: m ? m[1].trim() : txt.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'))?.trim() || '', caminho: rel(file) });
  }
  return out;
}
async function listCommands() {
  const dir = path.join(jarvisDir(), 'commands');
  const out = [];
  for (const f of await fsp.readdir(dir).catch(() => [])) {
    if (!f.endsWith('.md')) continue;
    const txt = await fsp.readFile(path.join(dir, f), 'utf8');
    out.push({ nome: '/' + f.replace(/\.md$/, ''), prompt: txt.trim(), caminho: rel(path.join(dir, f)) });
  }
  return out;
}
async function listScripts() {
  const dir = safe('scripts');
  return (await fsp.readdir(dir).catch(() => [])).map(f => ({ nome: f, caminho: 'scripts/' + f }));
}
async function listMcp() {
  for (const f of ['.mcp.json', '.jarvis/mcp.json']) {
    try { const j = JSON.parse(await fsp.readFile(safe(f), 'utf8')); return Object.entries(j.mcpServers || {}).map(([nome, v]) => ({ nome, comando: [v.command, ...(v.args || [])].join(' ') || v.url || '' })); } catch {}
  }
  return [];
}
const memPath = () => path.join(jarvisDir(), 'memoria.md');
async function readMem() { return fsp.readFile(memPath(), 'utf8').catch(() => ''); }
const tasksPath = () => safe('Tarefas.md');
async function readTasks() {
  const txt = await fsp.readFile(tasksPath(), 'utf8').catch(() => '');
  return txt.split('\n').map((l, i) => { const m = l.match(/^\s*- \[( |x)\] (.*)$/i); return m ? { linha: i, feita: m[1].toLowerCase() === 'x', texto: m[2] } : null; }).filter(Boolean);
}

// ---------- Ferramentas do agente ----------
const TOOLS = [
  { name: 'listar_arquivos', description: 'Lista arquivos e pastas do Vault (inclui JSON, .env, planilhas, imagens, scripts).', input_schema: { type: 'object', properties: { pasta: { type: 'string', description: 'Pasta relativa ao Vault. Vazio = raiz.' }, ocultos: { type: 'boolean' } } } },
  { name: 'ler_arquivo', description: 'Lê o conteúdo de um arquivo de texto do Vault.', input_schema: { type: 'object', properties: { caminho: { type: 'string' } }, required: ['caminho'] } },
  { name: 'escrever_arquivo', description: 'Cria, sobrescreve ou acrescenta conteúdo em um arquivo do Vault. Cria pastas se necessário.', input_schema: { type: 'object', properties: { caminho: { type: 'string' }, conteudo: { type: 'string' }, modo: { type: 'string', enum: ['sobrescrever', 'acrescentar'] } }, required: ['caminho', 'conteudo'] } },
  { name: 'buscar_no_vault', description: 'Busca um termo (sem diferenciar maiúsculas) no nome e no conteúdo dos arquivos de texto do Vault.', input_schema: { type: 'object', properties: { termo: { type: 'string' } }, required: ['termo'] } },
  { name: 'abrir_no_painel', description: 'Mostra um arquivo (nota, imagem, site HTML, JSON, planilha CSV) no painel de visualização do usuário.', input_schema: { type: 'object', properties: { caminho: { type: 'string' } }, required: ['caminho'] } },
  { name: 'ler_skill', description: 'Carrega as instruções completas de uma skill antes de executar a tarefa correspondente.', input_schema: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } },
  { name: 'salvar_memoria', description: 'Guarda um fato duradouro sobre o usuário, preferências ou decisões, para lembrar nas próximas conversas.', input_schema: { type: 'object', properties: { fato: { type: 'string' } }, required: ['fato'] } },
  { name: 'listar_tarefas', description: 'Lista as tarefas do arquivo Tarefas.md (pendentes e concluídas).', input_schema: { type: 'object', properties: {} } },
  { name: 'adicionar_tarefa', description: 'Adiciona uma tarefa pendente em Tarefas.md. Pode incluir data como 📅 2026-11-10.', input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
  { name: 'concluir_tarefa', description: 'Marca como concluída a primeira tarefa pendente que contém o trecho informado.', input_schema: { type: 'object', properties: { trecho: { type: 'string' } }, required: ['trecho'] } },
  { name: 'executar_comando', description: 'Executa um comando de terminal dentro da pasta do Vault (scripts, Claude Code via `claude -p`, Codex, git etc.). Só funciona se o usuário habilitou nas configurações.', input_schema: { type: 'object', properties: { comando: { type: 'string' } }, required: ['comando'] } },
];

async function runTool(name, input, ctx) {
  switch (name) {
    case 'listar_arquivos': {
      const flat = (nodes, pre = '') => nodes.flatMap(n => [pre + (n.tipo === 'pasta' ? '📁 ' : '') + n.caminho, ...(n.filhos ? flat(n.filhos, pre) : [])]);
      return flat(await tree(input.pasta || '', !!input.ocultos)).slice(0, 400).join('\n') || '(vazio)';
    }
    case 'ler_arquivo': {
      const p = safe(input.caminho); const st = await fsp.stat(p);
      if (st.size > 400_000) return 'Arquivo grande demais (' + st.size + ' bytes).';
      return await fsp.readFile(p, 'utf8');
    }
    case 'escrever_arquivo': {
      const p = safe(input.caminho); await fsp.mkdir(path.dirname(p), { recursive: true });
      if (input.modo === 'acrescentar') await fsp.appendFile(p, input.conteudo); else await fsp.writeFile(p, input.conteudo);
      ctx.events.push({ tipo: 'arquivo_alterado', caminho: rel(p) });
      return 'OK: ' + rel(p);
    }
    case 'buscar_no_vault': {
      const t = String(input.termo).toLowerCase(); const hits = [];
      for (const f of await walkFiles(vault())) {
        const r = rel(f);
        if (r.toLowerCase().includes(t)) hits.push(r + ' (nome)');
        if (!TEXT_EXT.test(path.basename(f))) continue;
        const txt = await fsp.readFile(f, 'utf8').catch(() => '');
        txt.split('\n').forEach((l, i) => { if (hits.length < 60 && l.toLowerCase().includes(t)) hits.push(`${r}:${i + 1}: ${l.trim().slice(0, 160)}`); });
      }
      return hits.join('\n') || 'Nada encontrado.';
    }
    case 'abrir_no_painel': safe(input.caminho); ctx.events.push({ tipo: 'abrir', caminho: input.caminho }); return 'Aberto no painel.';
    case 'ler_skill': {
      const s = (await listSkills()).find(s => s.nome.toLowerCase() === String(input.nome).toLowerCase());
      if (!s) return 'Skill não encontrada. Disponíveis: ' + (await listSkills()).map(s => s.nome).join(', ');
      return fsp.readFile(safe(s.caminho), 'utf8');
    }
    case 'salvar_memoria': {
      await fsp.mkdir(jarvisDir(), { recursive: true });
      const d = new Date().toISOString().slice(0, 10);
      await fsp.appendFile(memPath(), `- (${d}) ${input.fato}\n`);
      return 'Memória salva.';
    }
    case 'listar_tarefas': {
      const t = await readTasks();
      return t.length ? t.map(x => `${x.feita ? '[x]' : '[ ]'} ${x.texto}`).join('\n') : 'Nenhuma tarefa.';
    }
    case 'adicionar_tarefa': {
      const p = tasksPath(); const cur = await fsp.readFile(p, 'utf8').catch(() => '# Tarefas\n');
      await fsp.writeFile(p, cur.replace(/\n*$/, '\n') + `- [ ] ${input.texto}\n`);
      ctx.events.push({ tipo: 'arquivo_alterado', caminho: 'Tarefas.md' });
      return 'Tarefa adicionada.';
    }
    case 'concluir_tarefa': {
      const p = tasksPath(); const lines = (await fsp.readFile(p, 'utf8').catch(() => '')).split('\n');
      const i = lines.findIndex(l => /- \[ \]/.test(l) && l.toLowerCase().includes(String(input.trecho).toLowerCase()));
      if (i < 0) return 'Tarefa pendente não encontrada.';
      lines[i] = lines[i].replace('- [ ]', '- [x]') + ` ✅ ${new Date().toISOString().slice(0, 10)}`;
      await fsp.writeFile(p, lines.join('\n'));
      ctx.events.push({ tipo: 'arquivo_alterado', caminho: 'Tarefas.md' });
      return 'Concluída: ' + lines[i];
    }
    case 'executar_comando': {
      if (!config.permitirComandos) return 'Execução de comandos está desabilitada. Peça ao usuário para habilitar em Configurações.';
      return new Promise(res => exec(input.comando, { cwd: vault(), timeout: 120_000, maxBuffer: 2_000_000 }, (err, so, se) =>
        res(((so || '') + (se ? '\n[stderr]\n' + se : '') + (err ? '\n[erro] ' + err.message : '')).slice(0, 20000) || '(sem saída)')));
    }
  }
  return 'Ferramenta desconhecida: ' + name;
}

async function systemPrompt() {
  const [skills, cmds, mem, tasks] = await Promise.all([listSkills(), listCommands(), readMem(), readTasks()]);
  const instr = await fsp.readFile(path.join(jarvisDir(), 'instrucoes.md'), 'utf8').catch(() => '');
  const pend = tasks.filter(t => !t.feita).slice(0, 15);
  return `Você é ${config.nome}, assistente pessoal de IA do usuário, inspirado no J.A.R.V.I.S. Trate o usuário por "${config.tratamento}".
Personalidade: ${config.personalidade}
Idioma: responda sempre em ${config.idioma}.
Data/hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}.

Você vive dentro do ambiente de trabalho do usuário (o "Vault", pasta ${vault()}). Use as ferramentas para ler, criar e editar arquivos, buscar informações, gerenciar tarefas e guardar memórias. Antes de executar uma tarefa coberta por uma skill, chame ler_skill. Ao criar um arquivo visual (imagem, HTML, carrossel), use abrir_no_painel para mostrar ao usuário.
Suas respostas finais serão LIDAS EM VOZ ALTA: seja breve (1 a 4 frases), sem tabelas nem markdown pesado, a menos que o usuário peça um texto longo — nesse caso, salve o texto em um arquivo e resuma em voz.

## Instruções do usuário
${instr || '(nenhuma)'}

## Skills disponíveis
${skills.map(s => `- ${s.nome}: ${s.descricao}`).join('\n') || '(nenhuma)'}

## Comandos rápidos
${cmds.map(c => c.nome).join(', ') || '(nenhum)'}

## Memória
${mem.trim().slice(-6000) || '(vazia)'}

## Tarefas pendentes
${pend.map(t => '- ' + t.texto).join('\n') || '(nenhuma)'}

Execução de comandos de terminal: ${config.permitirComandos ? 'HABILITADA (cuidado com comandos destrutivos; confirme antes de apagar algo)' : 'desabilitada'}.`;
}

// ---------- LLM ----------
async function callAnthropic(sys, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.modelo, max_tokens: 4096, system: sys, tools: TOOLS, messages }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || JSON.stringify(j));
  return j;
}
const oaTools = TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
async function callOpenAI(messages) {
  const r = await fetch(config.openaiBaseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.openaiKey },
    body: JSON.stringify({ model: config.modelo, messages, tools: oaTools }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || JSON.stringify(j));
  return j;
}

// Histórico simples em memória (texto apenas), por sessão
const sessions = new Map();
async function chat(sessionId, userText) {
  const hist = sessions.get(sessionId) || [];
  const ctx = { events: [] };
  const sys = await systemPrompt();
  let finalText = '';

  if (config.provedor === 'anthropic') {
    if (!config.anthropicKey) throw new Error('Configure sua chave da Anthropic em Configurações.');
    const msgs = [...hist.map(h => ({ role: h.role, content: h.text })), { role: 'user', content: userText }];
    for (let step = 0; step < config.maxPassos; step++) {
      const res = await callAnthropic(sys, msgs);
      msgs.push({ role: 'assistant', content: res.content });
      const uses = res.content.filter(b => b.type === 'tool_use');
      finalText = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (!uses.length || res.stop_reason !== 'tool_use') break;
      const results = [];
      for (const u of uses) {
        ctx.events.push({ tipo: 'ferramenta', nome: u.name, entrada: u.input });
        let out; try { out = await runTool(u.name, u.input || {}, ctx); } catch (e) { out = 'Erro: ' + e.message; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: String(out) });
      }
      msgs.push({ role: 'user', content: results });
    }
  } else {
    if (!config.openaiKey) throw new Error('Configure sua chave da OpenAI (ou compatível) em Configurações.');
    const msgs = [{ role: 'system', content: sys }, ...hist.map(h => ({ role: h.role, content: h.text })), { role: 'user', content: userText }];
    for (let step = 0; step < config.maxPassos; step++) {
      const res = await callOpenAI(msgs);
      const m = res.choices[0].message;
      msgs.push(m);
      finalText = (m.content || '').trim();
      if (!m.tool_calls?.length) break;
      for (const c of m.tool_calls) {
        let input = {}; try { input = JSON.parse(c.function.arguments || '{}'); } catch {}
        ctx.events.push({ tipo: 'ferramenta', nome: c.function.name, entrada: input });
        let out; try { out = await runTool(c.function.name, input, ctx); } catch (e) { out = 'Erro: ' + e.message; }
        msgs.push({ role: 'tool', tool_call_id: c.id, content: String(out) });
      }
    }
  }
  hist.push({ role: 'user', text: userText }, { role: 'assistant', text: finalText || '(sem resposta)' });
  sessions.set(sessionId, hist.slice(-30));
  return { texto: finalText, eventos: ctx.events };
}

// ---------- TTS opcional (ElevenLabs / OpenAI) ----------
async function tts(text) {
  const v = config.voz;
  if (v.motor === 'elevenlabs') {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.elevenlabsVoiceId}`, {
      method: 'POST', headers: { 'xi-api-key': v.elevenlabsKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
    });
    if (!r.ok) throw new Error('ElevenLabs: ' + (await r.text()));
    return Buffer.from(await r.arrayBuffer());
  }
  if (v.motor === 'openai') {
    const r = await fetch(config.openaiBaseUrl.replace(/\/$/, '') + '/audio/speech', {
      method: 'POST', headers: { authorization: 'Bearer ' + config.openaiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: v.openaiVoz || 'onyx', input: text }),
    });
    if (!r.ok) throw new Error('OpenAI TTS: ' + (await r.text()));
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error('Motor de voz do navegador não usa o servidor.');
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, no) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } }); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/config' && req.method === 'GET') return send(res, 200, publicConfig());
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const body = await readBody(req);
      const cur = JSON.parse(JSON.stringify(config));
      // Não sobrescreve chaves com o valor mascarado
      for (const k of ['anthropicKey', 'openaiKey']) if (String(body[k] || '').startsWith('••••')) delete body[k];
      if (body.voz && String(body.voz.elevenlabsKey || '').startsWith('••••')) delete body.voz.elevenlabsKey;
      saveConfig(deepMerge(cur, body));
      return send(res, 200, publicConfig());
    }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { texto, sessao = 'padrao' } = await readBody(req);
      return send(res, 200, await chat(sessao, texto));
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') { sessions.clear(); return send(res, 200, { ok: true }); }
    if (url.pathname === '/api/tree') return send(res, 200, { vault: vault(), arvore: await tree('', url.searchParams.get('ocultos') === '1') });
    if (url.pathname === '/api/arsenal') return send(res, 200, { skills: await listSkills(), comandos: await listCommands(), scripts: await listScripts(), mcp: await listMcp(), ferramentas: TOOLS.map(t => ({ nome: t.name, descricao: t.description })) });
    if (url.pathname === '/api/tarefas') return send(res, 200, await readTasks());
    if (url.pathname === '/api/memoria') return send(res, 200, { texto: await readMem() });
    if (url.pathname === '/api/tts' && req.method === 'POST') { const { texto } = await readBody(req); return send(res, 200, await tts(texto), 'audio/mpeg'); }
    if (url.pathname === '/api/salvar' && req.method === 'POST') {
      const { caminho, conteudo } = await readBody(req); const p = safe(caminho);
      await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, conteudo); return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/vault/')) {
      const p = safe(decodeURIComponent(url.pathname.slice(7)));
      const ext = path.extname(p).toLowerCase();
      return send(res, 200, await fsp.readFile(p), MIME[ext] || (TEXT_EXT.test(path.basename(p)) ? 'text/plain; charset=utf-8' : 'application/octet-stream'));
    }
    // estáticos
    const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'proibido', 'text/plain');
    return send(res, 200, await fsp.readFile(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    const code = e.code === 'ENOENT' ? 404 : 500;
    return send(res, code, { erro: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ${config.nome} online em http://localhost:${PORT}`);
  console.log(`  Vault: ${vault()}`);
  console.log(`  Provedor: ${config.provedor} (${config.modelo})${(config.provedor === 'anthropic' ? config.anthropicKey : config.openaiKey) ? '' : '  — configure a chave em Configurações'}\n`);
});
