// Jarvis — interface
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || r.statusText);
  return j;
};
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = (s) => (window.marked ? marked.parse(s || '') : `<pre>${esc(s)}</pre>`);

let CFG = null;
let state = 'idle'; // idle | ouvindo | pensando | falando
let comandos = [];
let current = null; // arquivo aberto
const sessao = 's' + Date.now();

// ---------- Estado / status ----------
function setState(s, label) {
  state = s;
  const labels = { idle: CFG?.palavraDeAtivacao && $('#chkWake').checked ? `Aguardando "${CFG.nome}"…` : 'Toque no microfone ou escreva', ouvindo: 'Ouvindo…', pensando: 'Processando…', falando: 'Falando…' };
  $('#orbLabel').textContent = label || labels[s];
  $('#btnMic').classList.toggle('live', s === 'ouvindo');
}

// ---------- Orbe ----------
const orb = $('#orb'), ctx = orb.getContext('2d');
let level = 0, t = 0;
function draw() {
  t += 0.016;
  const W = orb.width, H = orb.height, cx = W / 2, cy = H / 2;
  ctx.clearRect(0, 0, W, H);
  const target = state === 'falando' ? 0.55 + Math.abs(Math.sin(t * 9)) * 0.35 : state === 'ouvindo' ? 0.3 + micLevel * 2 : state === 'pensando' ? 0.35 : 0.12;
  level += (Math.min(target, 1) - level) * 0.12;
  const hue = state === 'pensando' ? 'rgba(240,179,90,' : 'rgba(95,212,232,';
  // halo
  const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 220);
  g.addColorStop(0, hue + (0.22 + level * 0.25) + ')'); g.addColorStop(1, hue + '0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 220, 0, Math.PI * 2); ctx.fill();
  // anéis
  for (let i = 0; i < 4; i++) {
    const r = 80 + i * 32 + Math.sin(t * (1 + i * 0.3)) * 4 * (1 + level * 4);
    ctx.strokeStyle = hue + (0.55 - i * 0.11) + ')';
    ctx.lineWidth = i === 0 ? 2 : 1;
    const span = state === 'pensando' ? Math.PI * 1.2 : Math.PI * 2;
    const start = state === 'pensando' ? t * (2 - i * 0.4) * (i % 2 ? -1 : 1) : 0;
    ctx.beginPath(); ctx.arc(cx, cy, r, start, start + span); ctx.stroke();
  }
  // marcações HUD
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.15);
  for (let i = 0; i < 60; i++) {
    ctx.rotate(Math.PI / 30);
    ctx.strokeStyle = hue + (i % 5 ? 0.18 : 0.5) + ')';
    ctx.beginPath(); ctx.moveTo(0, 210); ctx.lineTo(0, i % 5 ? 216 : 224); ctx.stroke();
  }
  ctx.restore();
  // núcleo onda
  ctx.beginPath();
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
    const wob = Math.sin(a * 6 + t * 4) * 6 * level + Math.sin(a * 3 - t * 2) * 4 * level;
    const r = 52 + wob + level * 18;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.fillStyle = hue + (0.12 + level * 0.3) + ')'; ctx.fill();
  ctx.strokeStyle = hue + '0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// nível do microfone para animar o orbe
let micLevel = 0;
async function startMeter() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 256;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    (function loop() { an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += Math.abs(v - 128); micLevel = s / buf.length / 64; requestAnimationFrame(loop); })();
  } catch {}
}

// ---------- Voz: saída ----------
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices();
  const sel = $('#selVoz'); if (!sel) return;
  const lang = (CFG?.idioma || 'pt-BR').slice(0, 2);
  const list = voices.filter(v => v.lang.startsWith(lang)).concat(voices.filter(v => !v.lang.startsWith(lang)));
  sel.innerHTML = '<option value="">Automática</option>' + list.map(v => `<option ${CFG?.voz?.nomeVoz === v.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
}
if ('speechSynthesis' in window) { speechSynthesis.onvoiceschanged = loadVoices; loadVoices(); }

const plain = (s) => s.replace(/```[\s\S]*?```/g, ' (código no texto) ').replace(/[*_#>`|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, 'link').trim();
let audioEl = null;
async function speak(text) {
  if (!text || $('#chkMute').checked) return;
  stopListening(true);
  setState('falando');
  const done = () => { setState('idle'); if ($('#chkWake').checked) startListening(true); };
  const clean = plain(text);
  if (CFG.voz.motor !== 'navegador') {
    try {
      const r = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: clean }) });
      if (!r.ok) throw new Error((await r.json()).erro);
      audioEl = new Audio(URL.createObjectURL(await r.blob()));
      audioEl.onended = done; audioEl.onerror = done; await audioEl.play(); return;
    } catch (e) { addMsg('err', 'Voz externa falhou, usando a do navegador: ' + e.message); }
  }
  if (!('speechSynthesis' in window)) return done();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = CFG.idioma; u.rate = +CFG.voz.velocidade || 1; u.pitch = +CFG.voz.tom || 1;
  const v = voices.find(v => v.name === CFG.voz.nomeVoz) || voices.find(v => v.lang === CFG.idioma);
  if (v) u.voice = v;
  u.onend = done; u.onerror = done;
  speechSynthesis.speak(u);
}
function shutUp() { speechSynthesis?.cancel(); if (audioEl) { audioEl.pause(); audioEl = null; } }

// ---------- Voz: entrada ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, wakeMode = false, suppressed = false;
function startListening(wake = false) {
  if (!SR) { addMsg('err', 'Reconhecimento de voz não suportado neste navegador. Use Chrome ou Edge.'); return; }
  if (listening) return;
  wakeMode = wake; suppressed = false;
  rec = new SR(); rec.lang = CFG.idioma; rec.interimResults = true; rec.continuous = wake;
  let finalTxt = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        const txt = r[0].transcript.trim();
        if (wakeMode) {
          const name = CFG.nome.toLowerCase();
          const idx = txt.toLowerCase().indexOf(name);
          if (idx >= 0) {
            const cmd = txt.slice(idx + name.length).replace(/^[\s,.!?]+/, '');
            shutUp();
            if (cmd.length > 1) send(cmd, true); else { stopListening(true); setTimeout(() => { startListening(false); setState('ouvindo', 'Sim, ' + CFG.tratamento + '?'); }, 200); }
            return;
          }
        } else finalTxt += ' ' + txt;
      } else interim += r[0].transcript;
    }
    if (!wakeMode && interim) $('#input').value = (finalTxt + ' ' + interim).trim();
  };
  rec.onend = () => {
    listening = false;
    if (suppressed) return;
    if (!wakeMode && finalTxt.trim()) { $('#input').value = ''; send(finalTxt.trim(), true); return; }
    if ($('#chkWake').checked && state !== 'pensando' && state !== 'falando') setTimeout(() => startListening(true), 250);
    else if (state === 'ouvindo') setState('idle');
  };
  rec.onerror = (e) => { if (e.error === 'not-allowed') { addMsg('err', 'Permissão do microfone negada.'); $('#chkWake').checked = false; } };
  rec.start(); listening = true;
  setState(wake ? 'idle' : 'ouvindo');
}
function stopListening(silent) { suppressed = !!silent; if (rec) try { rec.stop(); } catch {} listening = false; }

$('#btnMic').onclick = () => {
  shutUp();
  if (listening && !wakeMode) { stopListening(); return; }
  stopListening(true);
  setTimeout(() => startListening(false), 120);
};
document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); $('#btnMic').click(); } if (e.key === 'Escape') shutUp(); });
$('#chkWake').onchange = (e) => { localStorage.jarvisWake = e.target.checked ? '1' : ''; if (e.target.checked) { startMeter(); startListening(true); } else stopListening(true); setState('idle'); };
$('#chkMute').onchange = (e) => { localStorage.jarvisMute = e.target.checked ? '1' : ''; if (e.target.checked) shutUp(); };

// ---------- Conversa ----------
function addMsg(kind, html, chips = []) {
  const d = document.createElement('div');
  d.className = 'msg ' + kind;
  d.innerHTML = html;
  if (chips.length) {
    const c = document.createElement('div'); c.className = 'chips';
    for (const ch of chips) {
      const s = document.createElement('span'); s.className = 'chip' + (ch.caminho ? ' link' : ''); s.textContent = ch.rotulo;
      if (ch.caminho) s.onclick = () => openFile(ch.caminho);
      c.appendChild(s);
    }
    d.appendChild(c);
  }
  $('#log').appendChild(d); $('#log').scrollTop = 1e9;
  return d;
}
const ROTULO = { listar_arquivos: 'listou arquivos', ler_arquivo: 'leu', escrever_arquivo: 'escreveu', buscar_no_vault: 'buscou', abrir_no_painel: 'abriu', ler_skill: 'skill', salvar_memoria: 'memória', listar_tarefas: 'tarefas', adicionar_tarefa: 'nova tarefa', concluir_tarefa: 'concluiu tarefa', executar_comando: 'terminal' };

async function send(text, byVoice = false) {
  text = text.trim(); if (!text) return;
  // comandos /rápidos
  const cmd = comandos.find(c => text.split(/\s/)[0] === c.nome);
  const payload = cmd ? cmd.prompt + (text.slice(cmd.nome.length).trim() ? '\n\nContexto adicional: ' + text.slice(cmd.nome.length).trim() : '') : text;
  addMsg('user', esc(text));
  stopListening(true);
  setState('pensando');
  try {
    const r = await api('/api/chat', { method: 'POST', body: { texto: payload, sessao } });
    const chips = [];
    let refresh = false;
    for (const ev of r.eventos) {
      if (ev.tipo === 'ferramenta') { const c = ev.entrada?.caminho || ev.entrada?.nome || ev.entrada?.termo || ev.entrada?.comando || ''; chips.push({ rotulo: `${ROTULO[ev.nome] || ev.nome}${c ? ' · ' + String(c).slice(0, 40) : ''}`, caminho: ['ler_arquivo', 'escrever_arquivo', 'abrir_no_painel'].includes(ev.nome) ? ev.entrada.caminho : null }); }
      if (ev.tipo === 'arquivo_alterado') { refresh = true; if (current === ev.caminho) openFile(ev.caminho); }
      if (ev.tipo === 'abrir') openFile(ev.caminho);
    }
    addMsg('bot', md(r.texto || '…'), chips);
    if (refresh) { loadTree(); loadTasks(); }
    if (chips.some(c => c.rotulo.startsWith('memória'))) loadMem();
    if (byVoice || $('#chkWake').checked || localStorage.jarvisSpeakAll) speak(r.texto); else setState('idle');
  } catch (e) {
    addMsg('bot err', esc(e.message)); setState('idle');
    if ($('#chkWake').checked) startListening(true);
  }
}
$('#form').onsubmit = (e) => { e.preventDefault(); const v = $('#input').value; $('#input').value = ''; send(v, false); };
$('#btnReset').onclick = async () => { await api('/api/reset', { method: 'POST' }); $('#log').innerHTML = ''; addMsg('bot', `<p>Conversa reiniciada. Em que posso ajudar, ${esc(CFG.tratamento)}?</p>`); };

// ---------- Vault ----------
const extOf = (n) => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
function renderTree(nodes) {
  return nodes.map(n => n.tipo === 'pasta'
    ? `<details ${n.caminho.split('/').length < 2 ? 'open' : ''}><summary>${esc(n.nome)}</summary><div class="kids">${renderTree(n.filhos)}</div></details>`
    : `<button class="file ${current === n.caminho ? 'sel' : ''}" data-path="${esc(n.caminho)}">${esc(n.nome.replace(/\.md$/, ''))}${extOf(n.nome) && extOf(n.nome) !== 'md' ? `<span class="ext">${esc(extOf(n.nome))}</span>` : ''}</button>`).join('');
}
async function loadTree() {
  const r = await api('/api/tree?ocultos=' + ($('#chkHidden').checked ? 1 : 0));
  $('#vaultPath').textContent = r.vault.split(/[\\/]/).pop(); $('#vaultPath').title = r.vault;
  $('#tree').innerHTML = renderTree(r.arvore) || '<p class="muted small" style="padding:10px">Vault vazio.</p>';
}
$('#tree').onclick = (e) => { const b = e.target.closest('.file'); if (b) openFile(b.dataset.path); };
$('#chkHidden').onchange = loadTree; $('#btnRefresh').onclick = loadTree;

const vurl = (p) => '/vault/' + p.split('/').map(encodeURIComponent).join('/');
async function openFile(p) {
  current = p;
  $$('.tree .file').forEach(b => b.classList.toggle('sel', b.dataset.path === p));
  $('#pvTitle').textContent = p; $('#pvTitle').title = p;
  $('#pvAsk').disabled = false; $('#pvOpen').hidden = false; $('#pvOpen').href = vurl(p);
  document.querySelector('.grid').classList.add('pv-open');
  const ext = extOf(p), pv = $('#pv');
  $('#pvEdit').disabled = !/^(md|txt|json|csv|js|ts|py|sh|html|css|yml|yaml|env|toml)$/.test(ext) && !p.split('/').pop().startsWith('.env');
  if (/^(png|jpe?g|gif|webp|svg)$/.test(ext)) pv.innerHTML = `<img src="${vurl(p)}?t=${Date.now()}" alt="${esc(p)}">`;
  else if (/^(mp4|webm|mov)$/.test(ext)) pv.innerHTML = `<video src="${vurl(p)}" controls></video>`;
  else if (/^(mp3|wav|m4a|ogg)$/.test(ext)) pv.innerHTML = `<audio src="${vurl(p)}" controls></audio>`;
  else if (ext === 'html' || ext === 'pdf') pv.innerHTML = `<iframe src="${vurl(p)}?t=${Date.now()}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>`;
  else {
    const txt = await (await fetch(vurl(p))).text();
    if (ext === 'md') pv.innerHTML = `<div class="md" style="padding:0">${md(txt.replace(/^---[\s\S]*?---\n/, ''))}</div>`;
    else if (ext === 'json') { let pretty = txt; try { pretty = JSON.stringify(JSON.parse(txt), null, 2); } catch {} pv.innerHTML = `<pre>${esc(pretty)}</pre>`; }
    else if (ext === 'csv' || ext === 'tsv') {
      const sep = ext === 'tsv' ? '\t' : (txt.split('\n')[0].includes(';') ? ';' : ',');
      const rows = txt.trim().split(/\r?\n/).slice(0, 500).map(l => l.split(sep));
      pv.innerHTML = `<table><thead><tr>${rows[0].map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } else pv.innerHTML = `<pre>${esc(txt)}</pre>`;
  }
}
$('#pvAsk').onclick = () => { $('#input').value = `Sobre o arquivo "${current}": `; $('#input').focus(); };
$('#pvEdit').onclick = async () => {
  const txt = await (await fetch(vurl(current))).text();
  $('#pv').innerHTML = `<textarea id="ed"></textarea><div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end"><button class="ghost" id="edCancel">Cancelar</button><button class="primary" id="edSave">Salvar</button></div>`;
  $('#ed').value = txt;
  $('#edCancel').onclick = () => openFile(current);
  $('#edSave').onclick = async () => { await api('/api/salvar', { method: 'POST', body: { caminho: current, conteudo: $('#ed').value } }); openFile(current); loadTasks(); };
};

// ---------- Arsenal / Tarefas / Memória ----------
async function loadArsenal() {
  const a = await api('/api/arsenal'); comandos = a.comandos;
  const sec = (t, items, fn) => `<div class="block"><h3>${t} · ${items.length}</h3>${items.map(fn).join('') || '<span class="muted small">nenhum</span>'}</div>`;
  $('#arsenal').innerHTML =
    sec('Skills', a.skills, s => `<div class="item" data-open="${esc(s.caminho)}"><b>${esc(s.nome)}</b><span>${esc(s.descricao)}</span></div>`) +
    sec('Comandos', a.comandos, c => `<div class="item" data-cmd="${esc(c.nome)}"><b>${esc(c.nome)}</b><span>${esc(c.prompt.split('\n')[0].slice(0, 90))}</span></div>`) +
    sec('Scripts', a.scripts, s => `<div class="item" data-open="${esc(s.caminho)}"><b>${esc(s.nome)}</b></div>`) +
    sec('Servidores MCP', a.mcp, m => `<div class="item"><b>${esc(m.nome)}</b><span class="mono">${esc(m.comando)}</span></div>`) +
    sec('Ferramentas do Jarvis', a.ferramentas, f => `<div class="item"><b class="mono">${esc(f.nome)}</b><span>${esc(f.descricao)}</span></div>`);
}
$('#arsenal').onclick = (e) => { const it = e.target.closest('.item'); if (!it) return; if (it.dataset.open) openFile(it.dataset.open); if (it.dataset.cmd) { $('#input').value = it.dataset.cmd + ' '; $('#input').focus(); } };
async function loadTasks() {
  const t = await api('/api/tarefas');
  const pend = t.filter(x => !x.feita), done = t.filter(x => x.feita);
  $('#tarefas').innerHTML = `<div class="block"><h3>Pendentes · ${pend.length}</h3></div>${pend.map(x => `<div class="task"><span>○</span><span>${esc(x.texto)}</span></div>`).join('')}<div class="block"><h3>Concluídas · ${done.length}</h3></div>${done.map(x => `<div class="task done"><span>●</span><span>${esc(x.texto)}</span></div>`).join('')}`;
}
async function loadMem() { const m = await api('/api/memoria'); $('#memoria').innerHTML = md(m.texto || '_Nada memorizado ainda. Diga: "Jarvis, lembre que…"_'); }

$$('.tab').forEach(b => b.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === b));
  $$('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === b.dataset.tab));
  document.querySelector('.grid').classList.add('side-open');
});

// ---------- Configurações ----------
const get = (o, k) => k.split('.').reduce((a, x) => a?.[x], o);
function fillCfg() {
  for (const el of $$('#cfgForm [name]')) { const v = get(CFG, el.name); if (el.type === 'checkbox') el.checked = !!v; else if (v !== undefined) el.value = v; }
  loadVoices();
}
$('#btnConfig').onclick = () => { fillCfg(); $('#dlgConfig').showModal(); };
$('#btnTestVoice').onclick = () => { readCfgForm(true); speak(`Olá, ${CFG.tratamento}. Sistemas online e prontos para trabalhar.`); };
function readCfgForm(apply) {
  const out = {};
  for (const el of $$('#cfgForm [name]')) {
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
    const ks = el.name.split('.'); let o = out; ks.slice(0, -1).forEach(k => (o = o[k] = o[k] || {})); o[ks.at(-1)] = v;
  }
  if (apply) { CFG = { ...CFG, ...out, voz: { ...CFG.voz, ...out.voz } }; }
  return out;
}
$('#cfgSave').onclick = async (e) => {
  e.preventDefault();
  try { CFG = await api('/api/config', { method: 'POST', body: readCfgForm() }); applyCfg(); $('#dlgConfig').close(); loadAll(); }
  catch (err) { alert('Erro ao salvar: ' + err.message); }
};
function applyCfg() {
  $('#brandName').textContent = CFG.nome.toUpperCase(); document.title = CFG.nome;
  const ok = CFG.provedor === 'anthropic' ? !!CFG.anthropicKey : !!CFG.openaiKey;
  $('#statusDot').classList.toggle('on', ok);
  $('#statusText').textContent = ok ? `${CFG.provedor} · ${CFG.modelo}` : 'sem chave de API';
  setState(state);
}

// ---------- Início ----------
async function loadAll() { await Promise.all([loadTree(), loadArsenal(), loadTasks(), loadMem()]).catch(e => addMsg('bot err', esc(e.message))); }
(async () => {
  CFG = await api('/api/config');
  $('#chkMute').checked = !!localStorage.jarvisMute;
  applyCfg(); await loadAll();
  const ok = CFG.provedor === 'anthropic' ? CFG.anthropicKey : CFG.openaiKey;
  addMsg('bot', ok
    ? `<p>Bom te ver, ${esc(CFG.tratamento)}. Posso ler e editar seu Vault, rodar skills, cuidar das tarefas e lembrar do que importa. Diga <b>"${esc(CFG.nome)}"</b> ou toque no microfone.</p>`
    : `<p>Olá, ${esc(CFG.tratamento)}. Para eu ganhar vida, abra <b>Configurações</b> e cole sua chave da Anthropic ou OpenAI.</p>`);
  if (localStorage.jarvisWake && SR) { $('#chkWake').checked = true; startMeter(); startListening(true); }
})();
