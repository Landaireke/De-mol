/* De Mol – zelf spelen (frontend) */
const socket = io();
let S = null;            // laatste state van de server
let lastHtml = '';
let joinedKey = null;    // welke route we gejoind hebben
let joinError = null;
const ui = {
  hostTab: 'spelers', playerTab: 'home', testId: null, showMole: false,
  needPin: false, roleRevealed: false, holdRole: false, execDismissed: null,
  draft: {}, prev: null,
};

// ---------- Helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = n => '€\u00a0' + Number(n || 0).toLocaleString('nl-BE');
const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
const clear = (...ids) => ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
const fmtTime = ts => new Date(ts).toLocaleString('nl-BE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDur = ms => { if (ms == null) return '—'; const t = Math.round(ms / 100) / 10; const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
function toast(msg, err = false, ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toast').appendChild(t); setTimeout(() => t.remove(), ms);
}
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }
function addRecent(code, role, name) {
  const r = LS.get('demol:recent', []).filter(x => !(x.code === code && x.role === role));
  r.unshift({ code, role, name, ts: Date.now() }); LS.set('demol:recent', r.slice(0, 8));
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Gekopieerd!'); }
  catch { window.prompt('Kopieer:', text); }
}

function fingerprint(cls = 'fp') {
  let s = '';
  for (let i = 0; i < 10; i++) {
    const rx = 4 + i * 4.4, ry = 6 + i * 5.4;
    const d1 = 14 + i * 7, g1 = 3 + (i % 3) * 3, d2 = 6 + (i % 4) * 4;
    s += `<ellipse cx="50" cy="64" rx="${rx}" ry="${ry}" fill="none" stroke-width="2.3" stroke-linecap="round" stroke-dasharray="${d1} ${g1} ${d2} ${g1 + 2}" transform="rotate(${i * 37} 50 64)"/>`;
  }
  return `<svg class="${cls}" viewBox="0 0 100 128" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}
function logo(size = 28) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#d6262f"/><g transform="translate(18 12) scale(.64)" stroke="#fff">${fingerprint('x').replace(/<\/?svg[^>]*>/g, '')}</g></svg>`;
}
const X_SVG = `<svg viewBox="0 0 100 100" style="width:min(40vh,300px)"><path d="M20 20 L80 80 M80 20 L20 80" stroke="#fff" stroke-width="10" stroke-linecap="round"/></svg>`;

const QBANK = [
  ['Is de mol een man of een vrouw?', ['Man', 'Vrouw']],
  ['Hoe oud is de mol?', ['Jonger dan 25', '25 – 34', '35 – 44', '45 of ouder']],
  ['Draagt de mol een bril of lenzen?', ['Ja', 'Nee']],
  ['Welke haarkleur heeft de mol?', ['Blond', 'Bruin', 'Zwart', 'Grijs/wit', 'Andere']],
  ['Heeft de mol kinderen?', ['Ja', 'Nee']],
  ['Heeft de mol een tatoeage?', ['Ja', 'Nee']],
  ['Welke kleur bovenstuk droeg de mol vandaag?', ['Zwart', 'Wit', 'Blauw', 'Rood', 'Groen', 'Andere']],
  ['Wat droeg de mol vandaag aan de voeten?', ['Sneakers', 'Schoenen', 'Laarzen', 'Sandalen/slippers']],
  ['Zat de mol vandaag in de groep die het meeste geld verdiende?', ['Ja', 'Nee']],
  ['Heeft de mol vandaag een joker verdiend?', ['Ja', 'Nee']],
  ['Waar zat de mol tijdens de laatste opdracht?', ['Groep A', 'Groep B', 'Alleen', 'Deed niet mee']],
  ['Hoeveel jokers heeft de mol momenteel?', ['0', '1', '2', '3 of meer']],
  ['Is de mol rechts- of linkshandig?', ['Rechtshandig', 'Linkshandig']],
  ['Wat dronk de mol bij het ontbijt?', ['Koffie', 'Thee', 'Sap / water', 'Niets']],
  ['In welke provincie woont de mol?', ['Antwerpen', 'Oost-Vlaanderen', 'West-Vlaanderen', 'Vlaams-Brabant', 'Limburg', 'Elders']],
  ['Is de mol ouder dan de spelleider?', ['Ja', 'Nee']],
  ['Had de mol een leidende rol bij de laatste opdracht?', ['Ja', 'Nee']],
  ['Heeft de mol ooit eerder De Mol gespeeld?', ['Ja', 'Nee']],
];
const MI_TEMPLATES = [
  ['De mol zat bij de laatste opdracht in de groep van …', 'all'],
  ['Bij de opdracht "…" heeft de mol bewust geld laten liggen.', 'all'],
  ['De mol is NIET …', 'all'],
  ['De mol droeg vandaag iets in de kleur …', 'all'],
  ['De mol heeft vandaag minstens één joker.', 'all'],
  ['Geheime opdracht: zorg ongemerkt dat … ', 'mole'],
  ['Jouw sabotage van vandaag: …', 'mole'],
];

// ---------- Routing ----------
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { page: parts[0] || 'home', code: (parts[1] || '').toUpperCase(), extra: parts[2] || null };
}
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', () => { S = null; joinError = null; joinedKey = null; ui.roleRevealed = false; doJoin(); render(); });

function doJoin() {
  const r = route();
  const key = r.page + ':' + r.code;
  if (r.page === 'home' || !r.code) { joinedKey = null; return; }
  if (r.page === 'host') {
    if (r.extra) { LS.set('demol:host:' + r.code, r.extra); history.replaceState(null, '', '#/host/' + r.code); }
    const t = LS.get('demol:host:' + r.code);
    if (!t) return render();
    socket.emit('join:host', { code: r.code, token: t }, res => {
      if (!res.ok) { joinError = res.error; LS.del('demol:host:' + r.code); render(); return; }
      joinedKey = key; addRecent(r.code, 'host');
    });
  } else if (r.page === 'play') {
    const t = LS.get('demol:player:' + r.code);
    if (!t) return render();
    socket.emit('join:player', { code: r.code, token: t }, res => {
      if (!res.ok) { joinError = res.error; LS.del('demol:player:' + r.code); render(); return; }
      joinedKey = key;
    });
  } else if (r.page === 'screen') {
    socket.emit('join:screen', { code: r.code }, res => {
      if (!res.ok) { joinError = res.error; render(); return; }
      joinedKey = key; addRecent(r.code, 'screen');
    });
  }
}
socket.on('connect', doJoin);
socket.on('disconnect', () => toast('Verbinding verbroken… opnieuw verbinden', true));
socket.on('lobbyDeleted', () => { toast('Deze lobby is verwijderd', true); go('#/'); });
socket.on('state', st => {
  const prev = S; S = st;
  notifyChanges(prev, st);
  if (st.role === 'player' && !st.removed && ui.playerTab === 'molinfo') markMolinfoSeen();
  render();
});

function notifyChanges(prev, st) {
  if (!prev || st.role !== 'player' || st.removed) return;
  if (st.molinfo && prev.molinfo && st.molinfo.length > prev.molinfo.length) {
    const m = st.molinfo[st.molinfo.length - 1];
    toast(m.target === 'mole' ? '🔴 Geheime molinfo ontvangen!' : '🕵️ Nieuwe molinfo!'); vibrate([80, 60, 80]);
  }
  const openNow = (st.tests || []).find(t => t.status === 'open' && t.participant && !t.submitted);
  const openPrev = (prev.tests || []).find(t => t.status === 'open');
  if (openNow && !openPrev) { toast('📝 De test is begonnen!'); vibrate(200); }
  if (st.myExec && st.myExec.isCurrent && !(prev.myExec && prev.myExec.isCurrent)) vibrate([300, 100, 300]);
}

function act(type, payload = {}) {
  const ev = S && S.role === 'host' ? 'host:action' : 'player:action';
  return new Promise(res => socket.emit(ev, { type, ...payload }, r => {
    if (!r || !r.ok) toast((r && r.error) || 'Er ging iets mis', true);
    res(r || {});
  }));
}

// ---------- Render ----------
function render() {
  const app = $('#app');
  let html;
  try { html = view(); } catch (e) { console.error(e); html = `<div class="wrap"><div class="card">Fout: ${esc(e.message)}</div></div>`; }
  if (html === lastHtml) return;
  const snap = {};
  app.querySelectorAll('input[id],textarea[id],select[id]').forEach(el => {
    if (el.dataset.nokeep !== undefined) return;
    snap[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  const a = document.activeElement; let fid = null, ss, se;
  if (a && a.id && app.contains(a)) { fid = a.id; try { ss = a.selectionStart; se = a.selectionEnd; } catch {} }
  const y = window.scrollY;
  app.innerHTML = html; lastHtml = html;
  for (const id in snap) {
    const el = document.getElementById(id);
    if (!el || el.dataset.nokeep !== undefined) continue;
    if (el.type === 'checkbox') el.checked = snap[id]; else el.value = snap[id];
  }
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch {} } }
  window.scrollTo(0, y);
}

function view() {
  const r = route();
  if (r.page === 'home' || !r.code) return viewHome();
  if (joinError) return viewError(joinError);
  if (r.page === 'host') {
    if (!LS.get('demol:host:' + r.code)) return viewHostLogin(r.code);
    if (!S || S.role !== 'host') return viewLoading();
    return viewHost();
  }
  if (r.page === 'play') {
    if (!LS.get('demol:player:' + r.code)) return viewPlayerJoin(r.code);
    if (!S || S.role !== 'player') return viewLoading();
    return viewPlayer();
  }
  if (r.page === 'screen') {
    if (!S || S.role !== 'screen') return viewLoading();
    return viewScreen();
  }
  return viewHome();
}
const viewLoading = () => `<div class="reveal"><div class="pulse">${logo(64)}</div><div class="muted">Verbinden…</div></div>`;
const viewError = msg => `<div class="wrap narrow"><div class="hero">${logo(72)}</div><div class="card stack center"><h2>Oeps</h2><p>${esc(msg)}</p><button class="btn-red" data-a="home">Naar startpagina</button></div></div>`;

// ---------- Home ----------
function viewHome() {
  const recent = LS.get('demol:recent', []);
  const roleName = { host: 'Spelleider', player: 'Speler', screen: 'Hoofdscherm' };
  return `
  <div class="wrap">
    <div class="hero"><div class="logo">${logo(96)}</div><h1>DE MOL</h1><p>Speel het spel zelf – met vrienden, familie of collega's</p></div>
    <div class="grid3" style="margin-top:1rem">
      <div class="card stack">
        <h2>🕵️ Meedoen als speler</h2>
        <div class="field"><label>Lobbycode</label><input id="h-code" maxlength="4" placeholder="ABCD" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.3em;font-weight:800"></div>
        <div class="field"><label>Jouw naam</label><input id="h-name" maxlength="30" placeholder="bv. Sofie"></div>
        <div class="field ${ui.needPin ? '' : 'hide'}"><label>Pincode (om opnieuw in te loggen)</label><input id="h-pin" inputmode="numeric" maxlength="4" placeholder="1234"></div>
        <button class="btn-red btn-block" data-a="joinPlayer">Meedoen</button>
      </div>
      <div class="card stack">
        <h2>🎬 Spelleider</h2>
        <p class="muted small">Maak een lobby, kies de mol, schrijf tests, beheer de pot en stuur molinfo.</p>
        <div class="field"><label>Naam van het spel</label><input id="h-lname" maxlength="60" placeholder="bv. De Mol – Ardennen 2026"></div>
        <button class="btn-gold btn-block" data-a="createLobby">Nieuwe lobby maken</button>
        <details><summary class="muted small" style="cursor:pointer">Lobby hervatten met spelleidercode</summary>
          <div class="stack" style="margin-top:.6rem">
            <input id="h-rcode" maxlength="4" placeholder="Lobbycode" style="text-transform:uppercase">
            <input id="h-rtoken" placeholder="Spelleidercode">
            <button class="btn-block" data-a="resumeHost">Hervatten</button>
          </div>
        </details>
      </div>
      <div class="card stack">
        <h2>📺 Hoofdscherm</h2>
        <p class="muted small">Open dit op een TV of laptop: lobbycode, pot, molinfo, testvoortgang, de executie en de ontmaskering.</p>
        <div class="field"><label>Lobbycode</label><input id="h-scode" maxlength="4" placeholder="ABCD" style="text-transform:uppercase;letter-spacing:.3em;font-weight:800"></div>
        <button class="btn-block" data-a="openScreen">Hoofdscherm openen</button>
      </div>
    </div>
    ${recent.length ? `<div class="card" style="margin-top:1rem"><h3>Recent</h3><div class="row">
      ${recent.map(x => `<button class="btn-sm" data-a="openRecent" data-code="${esc(x.code)}" data-role="${esc(x.role)}">${roleName[x.role] || x.role} · <b>${esc(x.code)}</b>${x.name ? ' · ' + esc(x.name) : ''}</button>`).join('')}
    </div></div>` : ''}
    <div class="card flat" style="margin-top:1rem">
      <h3>Hoe werkt het?</h3>
      <ol class="muted small" style="margin:0;padding-left:1.2rem;line-height:1.7">
        <li>De <b>spelleider</b> maakt een lobby en deelt de code. Spelers doen mee op hun eigen gsm.</li>
        <li>De spelleider kiest (of loot) <b>de mol</b> en start het spel. Iedereen bekijkt in het geheim zijn rol.</li>
        <li>Speel <b>opdrachten</b> in het echt; de spelleider houdt de <b>pot</b> bij en de mol krijgt geheime sabotage-opdrachten.</li>
        <li>Spelers houden hun <b>molboekje</b> bij en krijgen af en toe <b>molinfo</b>.</li>
        <li>Na elke aflevering volgt de <b>test</b> over de mol. Laagste score (bij gelijkstand: traagste) gaat eruit tijdens de <b>executie</b> op het hoofdscherm. <b>Jokers</b> tellen als juist antwoord, een <b>vrijstelling</b> beschermt je.</li>
        <li>In de <b>finale</b> wordt de winnaar bekendgemaakt en de mol ontmaskerd.</li>
      </ol>
    </div>
  </div>`;
}

function viewHostLogin(code) {
  return `<div class="wrap narrow"><div class="hero">${logo(72)}<h1 style="font-size:1.6rem">SPELLEIDER</h1><p>Lobby <b>${esc(code)}</b></p></div>
  <div class="card stack"><div class="field"><label>Spelleidercode</label><input id="hl-token" placeholder="Plak je spelleidercode"></div>
  <button class="btn-gold btn-block" data-a="hostLogin" data-code="${esc(code)}">Inloggen</button>
  <button class="btn-ghost btn-block" data-a="home">Terug</button></div></div>`;
}
function viewPlayerJoin(code) {
  return `<div class="wrap narrow"><div class="hero">${logo(72)}<h1 style="font-size:1.6rem">DE MOL</h1><p>Lobby <b>${esc(code)}</b></p></div>
  <div class="card stack">
    <div class="field"><label>Jouw naam</label><input id="pj-name" maxlength="30" placeholder="bv. Sofie"></div>
    <div class="field ${ui.needPin ? '' : 'hide'}"><label>Pincode</label><input id="pj-pin" inputmode="numeric" maxlength="4"></div>
    <button class="btn-red btn-block" data-a="joinPlayer2" data-code="${esc(code)}">Meedoen</button>
    <button class="btn-ghost btn-block" data-a="home">Terug</button>
  </div></div>`;
}

// ---------- Spelleider ----------
const HOST_TABS = [['spelers', '👥 Spelers'], ['opdrachten', '💰 Opdrachten & pot'], ['molinfo', '🕵️ Molinfo'], ['tests', '📝 Tests'], ['executie', '🟢 Executie'], ['finale', '🏆 Finale']];
function pName(id) { const p = (S.playersFull || S.players).find(x => x.id === id); return p ? p.name : '?'; }

function viewHost() {
  const screenOpts = [['lobby', 'Lobby / uitnodiging'], ['dashboard', 'Dashboard'], ['pot', 'Pot'], ['molinfo', 'Laatste molinfo'], ['test', 'Testvoortgang'], ['execution', 'Executie'], ['finale', 'Finale']];
  const execBadge = S.execution ? '<span class="badge">!</span>' : '';
  const body = { spelers: hostPlayers, opdrachten: hostOpdrachten, molinfo: hostMolinfo, tests: hostTests, executie: hostExec, finale: hostFinale }[ui.hostTab] || hostPlayers;
  return `
  <div class="topbar"><div class="wrap">
    <div class="brand">${logo()} <span>DE MOL</span></div>
    <span class="code-badge">${esc(S.code)}</span>
    <span class="muted small grow">${esc(S.name)} · ${S.phase === 'lobby' ? 'Lobby' : S.phase === 'finale' ? 'Finale' : 'Spel bezig'}</span>
    <span class="money">${euro(S.pot)}</span>
    <div class="row nowrap"><span class="small muted">📺</span>
      <select data-nokeep data-c="screenView" style="width:auto;padding:.4rem .6rem">${screenOpts.map(([v, l]) => `<option value="${v}" ${S.screen.view === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <button class="btn-sm" data-a="toggleShowMole" title="Mol tonen/verbergen">${ui.showMole ? '🙈 Verberg mol' : '👁 Toon mol'}</button>
  </div>
  <div class="tabs">${HOST_TABS.map(([k, l]) => `<button class="tab ${ui.hostTab === k ? 'active' : ''}" data-a="hostTab" data-tab="${k}">${l}${k === 'executie' ? execBadge : ''}</button>`).join('')}</div>
  </div>
  <div class="wrap">${body()}</div>`;
}

function hostPlayers() {
  const ps = S.playersFull;
  const mole = ps.find(p => p.id === S.moleId);
  const origin = location.origin + location.pathname;
  return `
  <div class="grid2">
    <div class="card stack">
      <h2>Uitnodigen</h2>
      <p>Spelers surfen naar <b>${esc(origin)}</b> en geven code <span class="code-badge">${esc(S.code)}</span> in.</p>
      <div class="row">
        <button class="btn-sm" data-a="copy" data-text="${esc(origin + '#/play/' + S.code)}">🔗 Kopieer spelerslink</button>
        <a class="btn btn-sm" href="#/screen/${esc(S.code)}" target="_blank">📺 Open hoofdscherm</a>
        <button class="btn-sm" data-a="copy" data-text="${esc(origin + '#/host/' + S.code + '/' + S.hostToken)}">🔑 Kopieer spelleiderlink</button>
      </div>
      <label class="row" style="color:var(--text);font-size:1rem"><input type="checkbox" data-nokeep data-c="lock" style="width:auto" ${S.locked ? 'checked' : ''}> Lobby vergrendelen (geen nieuwe spelers)</label>
      <p class="tiny muted">Bewaar de spelleiderlink goed: daarmee kan je het spel later of op een ander toestel hervatten.</p>
    </div>
    <div class="card stack ${S.moleId ? 'red' : ''}">
      <h2>De mol</h2>
      <p>Huidige mol: <b>${mole ? (ui.showMole ? esc(mole.name) : '•••••• (verborgen)') : '<span class="muted">nog niet gekozen</span>'}</b></p>
      <div class="row">
        <select id="mole-select" data-nokeep class="grow" style="width:auto">
          <option value="">Kies een speler…</option>
          ${ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <button data-a="setMole">Instellen</button>
        <button class="btn-red" data-a="randomMole">🎲 Willekeurig</button>
      </div>
      ${S.phase === 'lobby'
        ? `<button class="btn-green btn-lg btn-block" data-a="startGame" ${ps.length < 2 || !S.moleId ? 'disabled' : ''}>▶ Start het spel</button>
           <p class="tiny muted">Bij de start ziet elke speler in het geheim of hij/zij de mol is.</p>`
        : `<div class="row"><span class="pill green">Spel gestart</span><span class="small muted">${ps.filter(p => p.roleSeen).length}/${ps.length} spelers hebben hun rol bekeken</span>
           <button class="btn-sm btn-ghost" data-a="backToLobby">Terug naar lobbyfase</button></div>`}
    </div>
  </div>
  <div class="card" style="margin-top:1rem">
    <div class="row" style="margin-bottom:.8rem"><h2 class="grow" style="margin:0">Spelers (${ps.filter(p => !p.eliminated).length} over / ${ps.length})</h2></div>
    <div class="list">
      ${ps.length ? ps.map(p => `
      <div class="item ${p.eliminated ? 'out' : ''} ${ui.showMole && p.id === S.moleId ? 'mole' : ''}">
        <div class="row">
          <span class="dot ${p.online ? 'on' : ''}" title="${p.online ? 'online' : 'offline'}"></span>
          <span class="pname">${esc(p.name)}</span>
          ${ui.showMole && p.id === S.moleId ? '<span class="pill red">MOL</span>' : ''}
          ${p.eliminated ? `<span class="pill red">Geëxecuteerd${p.eliminatedIn ? ' · ' + esc(p.eliminatedIn) : ''}</span>` : ''}
          <span class="tiny muted">pin ${esc(p.pin)}</span>
          <span class="grow"></span>
          <span class="small muted">Jokers</span>
          <span class="counter"><button data-a="pAdj" data-id="${p.id}" data-f="jokers" data-d="-1">−</button><span>${p.jokers}</span><button data-a="pAdj" data-id="${p.id}" data-f="jokers" data-d="1">+</button></span>
          <span class="small muted">Vrijst.</span>
          <span class="counter"><button data-a="pAdj" data-id="${p.id}" data-f="exemptions" data-d="-1">−</button><span>${p.exemptions}</span><button data-a="pAdj" data-id="${p.id}" data-f="exemptions" data-d="1">+</button></span>
          <button class="btn-sm" data-a="renamePlayer" data-id="${p.id}" title="Hernoemen">✎</button>
          <button class="btn-sm" data-a="toggleElim" data-id="${p.id}">${p.eliminated ? '↩ Terughalen' : '✖ Eruit'}</button>
          <button class="btn-sm btn-ghost" data-a="removePlayer" data-id="${p.id}" title="Verwijderen">🗑</button>
        </div>
      </div>`).join('') : '<p class="muted">Nog geen spelers. Deel de code!</p>'}
    </div>
    <div class="row" style="margin-top:.8rem">
      <input id="add-player" class="grow" style="width:auto" placeholder="Speler handmatig toevoegen (bv. zonder gsm)">
      <button data-a="addPlayer">Toevoegen</button>
    </div>
  </div>
  <div class="card flat" style="margin-top:1rem"><div class="row"><span class="grow muted small">Gevarenzone</span><button class="btn-sm btn-ghost" data-a="deleteLobby">Lobby definitief verwijderen</button></div></div>`;
}

function hostOpdrachten() {
  return `
  <div class="grid2">
    <div class="card stack">
      <div class="row"><h2 class="grow" style="margin:0">De pot</h2><span class="money big-money">${euro(S.pot)}</span></div>
      <div class="row nowrap"><input id="pot-amount" type="number" inputmode="numeric" placeholder="Bedrag" style="width:8rem"><input id="pot-reason" class="grow" placeholder="Reden (bv. jokers gekocht)"></div>
      <div class="row"><button class="btn-green grow" data-a="potAdd" data-sign="1">+ Toevoegen</button><button class="btn-red grow" data-a="potAdd" data-sign="-1">− Afnemen</button></div>
      <div class="list" style="max-height:320px;overflow:auto">
        ${S.potLog.slice().reverse().map(e => `<div class="item row nowrap"><span class="money" style="color:${e.amount < 0 ? 'var(--red2)' : 'var(--gold)'}">${e.amount > 0 ? '+' : ''}${euro(e.amount)}</span><span class="grow small">${esc(e.reason)}</span><span class="tiny muted">${fmtTime(e.ts)}</span><button class="btn-sm btn-ghost icon-btn" data-a="potRemove" data-id="${e.id}">✕</button></div>`).join('') || '<p class="muted small">Nog geen geld in de pot.</p>'}
      </div>
    </div>
    <div class="card stack">
      <h2>Nieuwe opdracht</h2>
      <div class="field"><label>Titel</label><input id="op-title" placeholder="bv. De schattenjacht"></div>
      <div class="field"><label>Uitleg voor de spelers</label><textarea id="op-desc" placeholder="Wat moeten de spelers doen?"></textarea></div>
      <div class="field"><label>Maximaal te verdienen (€)</label><input id="op-max" type="number" inputmode="numeric" placeholder="bv. 2000"></div>
      <div class="field"><label>🔴 Geheime opdracht voor de mol (enkel de mol ziet dit)</label><textarea id="op-mol" placeholder="bv. Zorg dat jouw groep te laat aankomt"></textarea></div>
      <button class="btn-gold" data-a="opAdd">Opdracht toevoegen</button>
    </div>
  </div>
  <h2 style="margin-top:1.4rem">Opdrachten (${S.opdrachten.length})</h2>
  <div class="list">
    ${S.opdrachten.map(o => `
    <div class="card stack">
      <div class="row"><h3 class="grow" style="margin:0">${esc(o.title)}</h3>
        <select data-nokeep data-c="opStatus" data-id="${o.id}" style="width:auto">
          ${['gepland', 'bezig', 'klaar'].map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
        <button class="btn-sm btn-ghost" data-a="opDelete" data-id="${o.id}">🗑</button></div>
      ${o.description ? `<p class="muted" style="margin:0;white-space:pre-wrap">${esc(o.description)}</p>` : ''}
      ${o.molOpdracht ? `<div class="mi secret"><div class="mt">Geheime molopdracht</div><div class="mx">${esc(o.molOpdracht)}</div></div>` : ''}
      <div class="row">
        <span class="small muted">Max: <b>${euro(o.maxAmount)}</b></span>
        ${o.earned != null ? `<span class="pill gold">Verdiend: ${euro(o.earned)}</span>` : ''}
        <span class="grow"></span>
        <input id="op-earn-${o.id}" type="number" inputmode="numeric" placeholder="Verdiend €" style="width:9rem">
        <button class="btn-sm btn-green" data-a="opResult" data-id="${o.id}">💰 In de pot</button>
      </div>
    </div>`).join('') || '<p class="muted">Nog geen opdrachten.</p>'}
  </div>`;
}

function hostMolinfo() {
  const ps = S.playersFull;
  return `
  <div class="grid2">
    <div class="card stack">
      <h2>Molinfo versturen</h2>
      <div class="field"><label>Sjabloon (optioneel)</label>
        <select data-nokeep data-c="miTemplate"><option value="">— Kies een sjabloon —</option>${MI_TEMPLATES.map((t, i) => `<option value="${i}">${esc(t[0])}</option>`).join('')}</select></div>
      <div class="field"><label>Ontvanger</label>
        <select id="mi-target">
          <option value="all">📢 Iedereen (ook hoofdscherm)</option>
          <option value="mole">🔴 Enkel de mol (geheim)</option>
          ${ps.filter(p => !p.eliminated).map(p => `<option value="${p.id}">👤 Enkel ${esc(p.name)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Titel</label><input id="mi-title" placeholder="bv. Molinfo aflevering 2"></div>
      <div class="field"><label>Bericht</label><textarea id="mi-text" placeholder="De mol…"></textarea></div>
      <button class="btn-red" data-a="miSend">Versturen</button>
    </div>
    <div class="card">
      <h2>Verstuurd (${S.molinfo.length})</h2>
      <div class="list">
        ${S.molinfo.slice().reverse().map(m => `
        <div class="mi ${m.target !== 'all' ? 'secret' : ''}">
          <div class="row"><span class="mt grow">${esc(m.title || 'Molinfo')}</span>
            <span class="pill ${m.target === 'all' ? 'blue' : 'red'}">${m.target === 'all' ? 'Iedereen' : m.target === 'mole' ? 'Mol' : esc(pName(m.target))}</span>
            <button class="btn-sm btn-ghost icon-btn" data-a="miDelete" data-id="${m.id}">✕</button></div>
          <div class="mx">${esc(m.text)}</div><div class="tiny muted">${fmtTime(m.ts)}</div>
        </div>`).join('') || '<p class="muted">Nog niets verstuurd.</p>'}
      </div>
    </div>
  </div>`;
}

function statusPill(s) {
  return { concept: '<span class="pill">Concept</span>', open: '<span class="pill gold">Open</span>', gesloten: '<span class="pill blue">Gesloten</span>', geexecuteerd: '<span class="pill red">Geëxecuteerd</span>' }[s] || s;
}
function hostTests() {
  const tests = S.testsFull;
  if (!ui.testId || !tests.find(t => t.id === ui.testId)) ui.testId = tests.length ? tests[tests.length - 1].id : null;
  const t = tests.find(x => x.id === ui.testId);
  return `
  <div class="card">
    <div class="row">
      ${tests.map(x => `<button class="btn-sm ${x.id === ui.testId ? 'btn-red' : ''}" data-a="selTest" data-id="${x.id}">${esc(x.title)} ${x.status === 'open' ? '●' : ''}</button>`).join('')}
      <span class="grow"></span>
      <input id="new-test" placeholder="Titel (bv. Aflevering 1)" style="width:14rem">
      <button class="btn-gold" data-a="testCreate">+ Nieuwe test</button>
    </div>
  </div>
  ${t ? hostTestDetail(t) : '<p class="muted center" style="margin-top:2rem">Maak je eerste test aan. De vraag “Wie is de mol?” wordt automatisch toegevoegd.</p>'}`;
}

function hostTestDetail(t) {
  const moleAns = t.answers[S.moleId];
  const header = `
    <div class="row"><h2 class="grow" style="margin:0">${esc(t.title)} ${statusPill(t.status)}</h2>
      ${t.status === 'concept' ? `<button class="btn-green" data-a="testOpen" data-id="${t.id}" ${S.phase === 'lobby' ? 'disabled title="Start eerst het spel"' : ''}>▶ Test openen</button>` : ''}
      ${t.status === 'open' ? `<button class="btn-red" data-a="testClose" data-id="${t.id}">■ Sluiten & uitslag berekenen</button>` : ''}
      ${t.status === 'gesloten' && !t.execution ? `<button class="btn-sm" data-a="testReopen" data-id="${t.id}">↩ Heropenen</button><button class="btn-green" data-a="execStart" data-id="${t.id}">🟢🔴 Start executie</button>` : ''}
      ${t.status !== 'concept' && t.status !== 'open' ? `<button class="btn-sm btn-gold" data-a="finaleSet" data-id="${t.id}">🏆 Gebruik als finale</button>` : ''}
      <button class="btn-sm btn-ghost" data-a="testDelete" data-id="${t.id}">🗑</button>
    </div>`;
  let body = '';
  if (t.status === 'concept') {
    body = `
      <div class="list" style="margin-top:1rem">
        ${t.questions.map((q, i) => `
        <div class="q">
          <div class="row"><span class="qn grow">Vraag ${i + 1}${q.type === 'wiemol' ? ' · automatisch' : ''}</span>
            <button class="btn-sm icon-btn" data-a="qMove" data-t="${t.id}" data-q="${q.id}" data-d="-1">↑</button>
            <button class="btn-sm icon-btn" data-a="qMove" data-t="${t.id}" data-q="${q.id}" data-d="1">↓</button>
            <button class="btn-sm btn-ghost icon-btn" data-a="qDelete" data-t="${t.id}" data-q="${q.id}">✕</button></div>
          <div class="qt">${esc(q.text)}</div>
          ${q.type === 'wiemol' ? '<div class="muted small">Opties = alle spelers die nog in het spel zitten. Juist antwoord = de mol.</div>'
            : `<div class="row small">${q.options.map((o, oi) => `<span class="pill ${q.correct === oi ? 'green' : ''}">${esc(o)}</span>`).join('')}</div>
               <div class="row" style="margin-top:.5rem"><span class="small muted">Juist antwoord:</span>${correctSelect(t, q, null)}</div>`}
        </div>`).join('')}
      </div>
      <div class="card flat stack" style="margin-top:1rem">
        <h3>Vraag toevoegen</h3>
        <select data-nokeep data-c="qBank"><option value="">📚 Kies uit de vragenbank…</option>${QBANK.map((b, i) => `<option value="${i}">${esc(b[0])}</option>`).join('')}</select>
        <input id="q-text" placeholder="Vraag, bv. Welke kleur jas droeg de mol vandaag?">
        <textarea id="q-opts" placeholder="Antwoordopties – één per regel"></textarea>
        <p class="tiny muted" style="margin:0">Tip: laat het juiste antwoord op “antwoord van de mol”. De mol vult de test naar waarheid over zichzelf in en zijn antwoorden tellen als correct. Je kan het ook zelf vastleggen.</p>
        <button data-a="qAdd" data-t="${t.id}">+ Vraag toevoegen</button>
      </div>`;
  } else if (t.status === 'open') {
    const done = t.participants.filter(pid => t.answers[pid] && t.answers[pid].submittedAt).length;
    body = `
      <div class="stack" style="margin-top:1rem">
        <div class="progress"><div style="width:${t.participants.length ? done / t.participants.length * 100 : 0}%"></div></div>
        <p><b>${done}</b> / ${t.participants.length} spelers hebben ingediend.</p>
        <div class="grid3">${t.participants.map(pid => {
          const a = t.answers[pid];
          const st = a && a.submittedAt ? `<span class="pill green">✓ ${fmtDur(a.durationMs)}</span>` : a ? '<span class="pill gold">bezig…</span>' : '<span class="pill">nog niet gestart</span>';
          return `<div class="item row"><span class="pname grow">${esc(pName(pid))}${ui.showMole && pid === S.moleId ? ' <span class="pill red">MOL</span>' : ''}</span>${st}</div>`;
        }).join('')}</div>
        ${moleAns && moleAns.submittedAt ? '' : '<p class="small" style="color:var(--gold)">⚠ De mol heeft nog niet ingediend. Vragen zonder vastgelegd antwoord worden gescoord op het antwoord van de mol.</p>'}
      </div>`;
  } else {
    const R = t.results;
    body = R ? `
      ${R.unresolved.length ? `<p style="color:var(--gold)">⚠ Vraag ${R.unresolved.map(i => i + 1).join(', ')} heeft geen juist antwoord (mol heeft niet ingediend). Leg het juiste antwoord hieronder vast.</p>` : ''}
      <div style="overflow-x:auto;margin-top:1rem"><table>
        <tr><th>#</th><th>Speler</th><th>Score</th><th>Jokers</th><th>Tijd</th><th></th></tr>
        ${R.ranking.map((r, i) => `<tr class="${r.playerId === R.eliminatedId ? 'loser' : ''} ${ui.showMole && r.isMole ? 'molerow' : ''}">
          <td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td><b>${r.score}</b> / ${t.questions.length}</td>
          <td>${r.jokersUsed || ''}</td><td>${fmtDur(r.durationMs)}</td>
          <td><div class="row">${ui.showMole && r.isMole ? '<span class="pill red">MOL</span>' : ''}${r.exempt ? '<span class="pill green">Vrijstelling</span>' : ''}${!r.submitted ? '<span class="pill">Niet ingediend</span>' : ''}${r.playerId === R.eliminatedId ? '<span class="pill red">⟶ Valt af</span>' : ''}</div></td></tr>`).join('')}
      </table></div>
      <p class="small muted">Laagste score valt af; bij gelijke score valt de traagste af. De mol en spelers met vrijstelling kunnen niet afvallen.</p>
      <h3 style="margin-top:1rem">Antwoorden per vraag</h3>
      <div class="list">${t.questions.map((q, qi) => {
        const counts = q.options.map((_, oi) => t.participants.filter(pid => t.answers[pid] && t.answers[pid].answers[qi] === oi).length);
        const ma = moleAns ? moleAns.answers[qi] : null;
        return `<div class="q"><div class="qn">Vraag ${qi + 1}</div><div class="qt">${esc(q.text)}</div>
          <div class="row small">${q.options.map((o, oi) => `<span class="pill ${isCorrect(t, q, qi, oi) ? 'green' : ''}">${esc(o)} · ${counts[oi]}</span>`).join('')}</div>
          ${q.type === 'normal' ? `<div class="row" style="margin-top:.5rem"><span class="small muted">Juist antwoord:</span>${correctSelect(t, q, ma, t.status === 'geexecuteerd')}</div>` : ''}
        </div>`;
      }).join('')}</div>` : '';
  }
  return `<div class="card" style="margin-top:1rem">${header}${body}</div>`;
}
function isCorrect(t, q, qi, oi) {
  if (q.type === 'wiemol') return q.optionIds && q.optionIds[oi] === S.moleId;
  if (q.correct !== null && q.correct !== undefined) return q.correct === oi;
  const ma = t.answers[S.moleId]; return !!(ma && ma.answers[qi] === oi);
}
function correctSelect(t, q, moleAnswer, disabled) {
  const molLabel = moleAnswer != null ? `Antwoord van de mol (${ui.showMole ? q.options[moleAnswer] : '…'})` : 'Antwoord van de mol';
  return `<select data-nokeep data-c="setCorrect" data-t="${t.id}" data-q="${q.id}" style="width:auto" ${disabled ? 'disabled' : ''}>
    <option value="" ${q.correct == null ? 'selected' : ''}>${esc(molLabel)}</option>
    ${q.options.map((o, oi) => `<option value="${oi}" ${q.correct === oi ? 'selected' : ''}>${esc(o)}</option>`).join('')}
  </select>`;
}

function hostExec() {
  const ex = S.execution;
  if (!ex) {
    const ready = S.testsFull.filter(t => t.status === 'gesloten' && !t.execution);
    return `<div class="card stack center"><h2>Geen executie bezig</h2>
      <p class="muted">Sluit een test af in het tabblad Tests en start dan de executie. Het hoofdscherm schakelt automatisch over.</p>
      ${ready.map(t => `<button class="btn-green" data-a="execStart" data-id="${t.id}">🟢🔴 Start executie: ${esc(t.title)}</button>`).join('')}</div>`;
  }
  const remaining = ex.total - ex.revealed;
  return `
  <div class="card stack center">
    <h2>Executie – ${esc(ex.testTitle)}</h2>
    <p class="muted">Klik op “Volgende naam”. Op het hoofdscherm (en de gsm van de speler) verschijnt de naam en kleurt het scherm groen of rood.</p>
    <div class="row" style="justify-content:center">${ex.shown.map(s => `<span class="pill ${s.red ? 'red' : 'green'}">${esc(s.name)}</span>`).join('')}</div>
    ${ex.done
      ? `<p><b>${ex.shown.some(s => s.red) ? 'De executie is voorbij.' : 'Niemand valt af.'}</b></p><button class="btn-gold btn-lg" data-a="execFinish">Executie afronden</button>`
      : `<button class="btn-red btn-lg" data-a="execNext">Volgende naam ▶</button><p class="small muted">${remaining} naam/namen te gaan</p>`}
    <button class="btn-sm btn-ghost" data-a="execCancel">Executie annuleren</button>
  </div>`;
}

function hostFinale() {
  const withRes = S.testsFull.filter(t => t.results);
  const f = S.finaleFull;
  const t = f && S.testsFull.find(x => x.id === f.testId);
  return `
  <div class="card stack">
    <h2>De finale</h2>
    <p class="muted">Kies de finaletest. De speler (niet de mol) met de hoogste score – bij gelijkstand de snelste – wint de pot.</p>
    <div class="row">
      ${withRes.map(t => `<button class="${f && f.testId === t.id ? 'btn-gold' : ''}" data-a="finaleSet" data-id="${t.id}">${esc(t.title)}</button>`).join('') || '<span class="muted">Nog geen afgesloten tests.</span>'}
    </div>
  </div>
  ${f ? `
  <div class="grid2" style="margin-top:1rem">
    <div class="card stack center">
      <h3>🏆 Winnaar (${esc(t ? t.title : '')})</h3>
      <div style="font-size:1.6rem;font-weight:900;color:var(--gold)">${ui.showMole ? esc(pName(f.winnerId)) : '••••••'}</div>
      <button class="btn-gold" data-a="finaleReveal" data-what="winner" ${f.revealedWinner ? 'disabled' : ''}>${f.revealedWinner ? 'Onthuld ✓' : 'Onthul winnaar op het scherm'}</button>
    </div>
    <div class="card stack center red">
      <h3>🕵️ De mol</h3>
      <div style="font-size:1.6rem;font-weight:900;color:var(--red2)">${ui.showMole ? esc(pName(S.moleId)) : '••••••'}</div>
      <button class="btn-red" data-a="finaleReveal" data-what="mole" ${f.revealedMole ? 'disabled' : ''}>${f.revealedMole ? 'Onthuld ✓' : 'Ontmasker de mol op het scherm'}</button>
    </div>
  </div>
  <div class="center" style="margin-top:1rem"><button class="btn-sm btn-ghost" data-a="finaleReset">Finale resetten</button></div>` : ''}`;
}

// ---------- Speler ----------
const P_TABS = [['home', '🏠', 'Home'], ['boekje', '📓', 'Molboekje'], ['molinfo', '🕵️', 'Molinfo'], ['test', '📝', 'Test'], ['opdrachten', '💰', 'Opdrachten']];
function seenKey() { return `demol:seen:${S.code}:${S.me.id}`; }
function unreadMolinfo() { const seen = LS.get(seenKey(), 0); return S.molinfo.filter(m => m.ts > seen).length; }
function markMolinfoSeen() { if (S && S.molinfo && S.molinfo.length) LS.set(seenKey(), Math.max(...S.molinfo.map(m => m.ts))); }

function viewPlayer() {
  if (S.removed) return viewError('Je bent uit deze lobby verwijderd door de spelleider.');
  const me = S.me;
  // Executie-overlay op de gsm
  if (S.execution && S.myExec && S.myExec.isCurrent) {
    const key = S.execution.testId + ':' + S.execution.revealed;
    if (ui.execDismissed !== key) return execHtml(S.execution, { closeKey: key });
  }
  if (S.phase === 'lobby') {
    return `${playerTop()}<div class="wrap narrow"><div class="reveal">
      <div class="pulse">${logo(90)}</div><h2>Welkom, ${esc(me.name)}!</h2>
      <p class="muted">Wachten tot de spelleider het spel start…</p>
      <div class="card" style="width:100%"><h3>In de lobby (${S.players.length})</h3><div class="row">${S.players.map(p => `<span class="pill ${p.id === me.id ? 'red' : ''}"><span class="dot ${p.online ? 'on' : ''}"></span>${esc(p.name)}</span>`).join('')}</div></div>
      <p class="small muted">Jouw pincode: <b>${esc(me.pin)}</b> – nodig om op een ander toestel in te loggen.</p>
    </div></div>`;
  }
  if (!me.roleSeen) return playerTop() + roleReveal();
  const unread = ui.playerTab === 'molinfo' ? 0 : unreadMolinfo();
  const openTest = S.tests.find(t => t.status === 'open' && t.participant && !t.submitted);
  const body = { home: pHome, boekje: pBoekje, molinfo: pMolinfo, test: pTest, opdrachten: pOpdrachten }[ui.playerTab] || pHome;
  return `${playerTop()}<div class="wrap narrow player-main">${body()}</div>
  <nav class="bottomnav">${P_TABS.map(([k, ico, l]) => `<button class="${ui.playerTab === k ? 'active' : ''}" data-a="pTab" data-tab="${k}"><span class="ico">${ico}</span>${l}
    ${k === 'molinfo' && unread ? `<span class="badge">${unread}</span>` : ''}${k === 'test' && openTest ? '<span class="badge">!</span>' : ''}</button>`).join('')}</nav>`;
}
function playerTop() {
  return `<div class="topbar"><div class="wrap" style="max-width:560px">
    <div class="brand">${logo()} <span>DE MOL</span></div><span class="grow"></span>
    <span class="small">${esc(S.me.name)}</span><span class="money">${euro(S.pot)}</span></div></div>`;
}
function roleReveal() {
  const m = S.me.isMole;
  if (!ui.roleRevealed) {
    return `<div class="reveal"><h2>Je rol is bepaald</h2><p class="muted">Zorg dat niemand meekijkt.</p>
      <button class="rolecard" data-a="revealRole" style="cursor:pointer">${fingerprint()}<h2>Tik om te onthullen</h2></button></div>`;
  }
  return `<div class="reveal">
    <div class="rolecard ${m ? 'mole' : 'notmole'}">${fingerprint()}
      <h2>${m ? 'JIJ BENT DE MOL' : 'Jij bent NIET de mol'}</h2>
      <p>${m ? 'Saboteer ongemerkt de opdrachten zodat er zo weinig mogelijk geld in de pot komt. Vertel het aan niemand! Je krijgt geheime opdrachten via de app.' : 'Ontmasker de mol. Houd je molboekje bij, verdien geld voor de pot en scoor goed op de tests.'}</p>
    </div>
    <button class="btn-lg ${m ? 'btn-red' : 'btn-green'}" data-a="roleSeen">Begrepen – verberg mijn rol</button></div>`;
}
function pHome() {
  const me = S.me;
  const alive = S.players.filter(p => !p.eliminated), out = S.players.filter(p => p.eliminated);
  const fin = S.finale;
  return `<div class="stack" style="margin-top:.5rem">
    ${fin && (fin.revealedWinner || fin.revealedMole) ? `<div class="card stack center">
      ${fin.revealedWinner ? `<div>🏆 De winnaar is <b style="color:var(--gold);font-size:1.3rem">${esc(fin.winnerName)}</b>${fin.winnerId === me.id ? '<br><b>Proficiat, jij wint de pot!</b>' : ''}</div>` : ''}
      ${fin.revealedMole ? `<div>🕵️ De mol was <b style="color:var(--red2);font-size:1.3rem">${esc(fin.moleName)}</b></div>` : ''}</div>` : ''}
    ${me.eliminated ? `<div class="card red center"><h2>Je bent geëxecuteerd</h2><p class="muted" style="margin:0">${esc(me.eliminatedIn || '')} – je kan nog meekijken, maar niet meer deelnemen aan tests.</p></div>` : ''}
    ${S.execution && !S.myExec ? `<div class="card center"><span class="pulse">🟢🔴</span> <b>De executie is bezig…</b> <span class="muted small">${S.execution.revealed} van ${S.execution.total}</span></div>` : ''}
    ${S.myExec && !S.myExec.isCurrent ? `<div class="card ${S.myExec.red ? 'red' : 'green'} center"><b>${S.myExec.red ? '🔴 Rood scherm – je bent eruit.' : '🟢 Groen scherm – je bent door!'}</b></div>` : ''}
    <div class="grid3" style="grid-template-columns:repeat(3,1fr)">
      <div class="card stat"><span class="small muted">Pot</span><span class="v money">${euro(S.pot)}</span></div>
      <div class="card stat"><span class="small muted">Jokers</span><span class="v">${me.jokers}</span></div>
      <div class="card stat"><span class="small muted">Vrijstelling</span><span class="v">${me.exemptions}</span></div>
    </div>
    <div class="card stack center">
      <button class="holdbtn btn-block ${ui.holdRole ? (me.isMole ? 'btn-red' : 'btn-green') : ''}" data-hold="role">
        ${ui.holdRole ? (me.isMole ? '🔴 JIJ BENT DE MOL' : '🟢 Jij bent niet de mol') : '👆 Houd ingedrukt om je rol te zien'}</button>
    </div>
    <div class="card"><h3>Nog in het spel (${alive.length})</h3><div class="row">${alive.map(p => `<span class="pill ${p.id === me.id ? 'red' : ''}">${esc(p.name)}</span>`).join('')}</div>
      ${out.length ? `<h3 style="margin-top:1rem">Geëxecuteerd</h3><div class="row">${out.map(p => `<span class="pill" style="text-decoration:line-through;opacity:.6">${esc(p.name)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="card flat"><div class="small muted">Laatste in de pot</div><div class="list" style="margin-top:.5rem">
      ${S.potLog.slice(-5).reverse().map(e => `<div class="row small"><span class="money">${e.amount > 0 ? '+' : ''}${euro(e.amount)}</span><span class="grow">${esc(e.reason)}</span></div>`).join('') || '<span class="muted small">Nog niets.</span>'}</div></div>
    <p class="tiny muted center">Jouw pincode: <b>${esc(me.pin)}</b> · Lobby ${esc(S.code)}</p>
  </div>`;
}
function pBoekje() {
  const nb = S.notebook;
  const others = S.players.filter(p => p.id !== S.me.id).sort((a, b) => (a.eliminated - b.eliminated));
  const top = others.filter(p => !p.eliminated).map(p => ({ p, v: nb.suspicion[p.id] || 0 })).sort((a, b) => b.v - a.v)[0];
  return `<div class="stack" style="margin-top:.5rem">
    <div class="card stack">
      <h2>🎯 Verdenkingsmeter</h2>
      ${top && top.v > 0 ? `<p class="small">Hoofdverdachte: <b style="color:var(--red2)">${esc(top.p.name)}</b> (${top.v}%)</p>` : '<p class="small muted">Schuif de balk naar rechts als je iemand verdenkt.</p>'}
      ${others.map(p => `<div class="sus-row ${p.eliminated ? 'item out' : ''}" style="${p.eliminated ? 'padding:.3rem .5rem' : ''}"><span class="pname">${esc(p.name)}</span>
        <input type="range" min="0" max="100" step="5" value="${nb.suspicion[p.id] || 0}" data-nokeep data-c="sus" data-id="${p.id}" ${p.eliminated ? 'disabled' : ''}>
        <span class="small" style="text-align:right">${nb.suspicion[p.id] || 0}%</span></div>`).join('')}
    </div>
    <div class="card stack">
      <h2>📓 Notities</h2>
      <select id="nb-tag"><option value="">Algemeen</option>${S.opdrachten.map(o => `<option value="${esc(o.title)}">Opdracht: ${esc(o.title)}</option>`).join('')}${S.players.filter(p => p.id !== S.me.id).map(p => `<option value="Over ${esc(p.name)}">Over ${esc(p.name)}</option>`).join('')}</select>
      <textarea id="nb-text" placeholder="Wat viel je op? Wie deed verdacht?"></textarea>
      <button class="btn-red" data-a="noteAdd">Opslaan in molboekje</button>
      <div class="list">${nb.notes.slice().reverse().map(n => `<div class="item"><div class="row"><span class="tiny muted grow">${fmtTime(n.ts)}${n.tag ? ' · <b>' + esc(n.tag) + '</b>' : ''}</span><button class="btn-sm btn-ghost icon-btn" data-a="noteDelete" data-id="${n.id}">✕</button></div><div style="white-space:pre-wrap">${esc(n.text)}</div></div>`).join('') || '<p class="muted small">Je molboekje is nog leeg. Alleen jij kan dit lezen.</p>'}</div>
    </div></div>`;
}
function pMolinfo() {
  return `<div class="stack" style="margin-top:.5rem"><h2>🕵️ Molinfo</h2>
    ${S.molinfo.slice().reverse().map(m => `<div class="mi ${m.target !== 'all' ? 'secret' : ''}">
      <div class="mt">${m.target === 'mole' ? '🔴 GEHEIM – enkel voor de mol: ' : m.target !== 'all' ? '🔒 Persoonlijk: ' : ''}${esc(m.title || 'Molinfo')}</div>
      <div class="mx">${esc(m.text)}</div><div class="tiny muted">${fmtTime(m.ts)}</div></div>`).join('') || '<p class="muted">Nog geen molinfo ontvangen.</p>'}</div>`;
}
function pOpdrachten() {
  return `<div class="stack" style="margin-top:.5rem"><h2>💰 Opdrachten</h2>
    ${S.opdrachten.slice().reverse().map(o => `<div class="card stack">
      <div class="row"><h3 class="grow" style="margin:0">${esc(o.title)}</h3><span class="pill ${o.status === 'klaar' ? 'green' : o.status === 'bezig' ? 'gold' : ''}">${esc(o.status)}</span></div>
      ${o.description ? `<p style="margin:0;white-space:pre-wrap" class="muted">${esc(o.description)}</p>` : ''}
      <div class="small">Te verdienen: <b>${euro(o.maxAmount)}</b>${o.earned != null ? ` · Verdiend: <b class="money">${euro(o.earned)}</b>` : ''}</div>
      ${o.molOpdracht ? `<div class="mi secret"><div class="mt">🔴 Jouw geheime molopdracht</div><div class="mx">${esc(o.molOpdracht)}</div></div>` : ''}
    </div>`).join('') || '<p class="muted">Nog geen opdrachten.</p>'}</div>`;
}
function pTest() {
  const open = S.tests.find(t => t.status === 'open');
  if (!open) {
    return `<div class="stack" style="margin-top:.5rem"><h2>📝 Test</h2><div class="card center muted">Er is momenteel geen test bezig.</div>
      ${S.tests.length ? `<div class="list">${S.tests.map(t => `<div class="item row"><span class="grow">${esc(t.title)}</span>${statusPill(t.status)}</div>`).join('')}</div>` : ''}</div>`;
  }
  if (!open.participant) return `<div class="card center" style="margin-top:1rem"><h2>${esc(open.title)}</h2><p class="muted">Je neemt niet deel aan deze test.</p></div>`;
  if (open.submitted) return `<div class="reveal"><div style="font-size:3rem">✅</div><h2>Test ingediend</h2><p class="muted">Wachten tot iedereen klaar is en de executie begint…</p></div>`;
  if (!open.started) {
    return `<div class="card stack center" style="margin-top:1rem"><h2>${esc(open.title)}</h2>
      <p>${open.questions.length} vragen over de mol.</p>
      <p class="small muted">Je tijd begint te lopen zodra je start. Bij gelijke score valt de traagste af. ${S.me.jokers ? `Je hebt <b>${S.me.jokers}</b> joker(s): elke joker telt als één extra juist antwoord.` : ''}</p>
      ${S.me.isMole ? '<div class="mi secret" style="text-align:left"><div class="mt">🔴 Jij bent de mol</div><div class="mx">Beantwoord de vragen naar waarheid over jezelf. Jouw antwoorden kunnen gebruikt worden als de juiste antwoorden.</div></div>' : ''}
      <button class="btn-red btn-lg" data-a="testStart" data-id="${open.id}">Start de test</button></div>`;
  }
  const d = ui.draft[open.id] || (ui.draft[open.id] = LS.get('demol:draft:' + open.id, { answers: [], jokers: 0 }));
  const answered = open.questions.filter((_, i) => d.answers[i] != null).length;
  return `<div class="stack" style="margin-top:.5rem">
    <div class="row"><h2 class="grow" style="margin:0">${esc(open.title)}</h2><span class="small muted">${answered}/${open.questions.length}</span></div>
    <div class="progress"><div style="width:${answered / open.questions.length * 100}%"></div></div>
    ${S.me.isMole ? '<div class="mi secret"><div class="mx">🔴 Mol: antwoord naar waarheid over jezelf.</div></div>' : ''}
    ${open.questions.map((q, i) => `<div class="q"><div class="qn">Vraag ${i + 1}</div><div class="qt">${esc(q.text)}</div>
      <div class="opts">${q.options.map((o, oi) => `<button class="opt ${d.answers[i] === oi ? 'sel' : ''}" data-a="answer" data-t="${open.id}" data-i="${i}" data-o="${oi}">${esc(o)}</button>`).join('')}</div></div>`).join('')}
    ${S.me.jokers ? `<div class="card row"><span class="grow">Jokers inzetten</span><span class="counter"><button data-a="jokerAdj" data-t="${open.id}" data-d="-1">−</button><span>${d.jokers}</span><button data-a="jokerAdj" data-t="${open.id}" data-d="1">+</button></span><span class="small muted">van ${S.me.jokers}</span></div>` : ''}
    <button class="btn-red btn-lg btn-block" data-a="testSubmit" data-t="${open.id}" ${answered < open.questions.length ? 'disabled' : ''}>Test indienen</button>
  </div>`;
}

// ---------- Executie (gedeeld) ----------
function execHtml(ex, opts = {}) {
  if (!ex.current) {
    return `<div class="exec"><div class="idle-title">EXECUTIE</div><div class="lg muted" style="font-size:1.5rem">${esc(ex.testTitle)}</div>
      ${fingerprint('fp')}<div class="muted pulse">Wie mag er door naar de volgende aflevering?</div></div>`;
  }
  const c = ex.current;
  return `<div class="exec ${c.red ? 'red' : 'green'}">
    <div class="bgres"></div>
    <div class="ename">${esc(c.name)}</div>
    <div class="fpwrap">${fingerprint('fp')}<div class="scan"></div></div>
    <div class="restext">${c.red ? 'Je bent geëxecuteerd.' : 'Je mag door naar de volgende aflevering.'}</div>
    ${opts.closeKey ? `<div class="footer"><button class="btn-sm" data-a="dismissExec" data-key="${esc(opts.closeKey)}" style="background:rgba(0,0,0,.35)">Sluiten</button></div>`
      : `<div class="footer">${ex.shown.slice(0, -1).map(s => `<span class="pill green" style="font-size:1rem">${esc(s.name)}</span>`).join('')}</div>`}
  </div>`;
}

// ---------- Hoofdscherm ----------
function viewScreen() {
  let v = S.screen.view;
  if (v === 'execution' && !S.execution) v = 'dashboard';
  if (S.execution && v === 'execution') return execHtml(S.execution);
  const head = `<div class="shead"><div class="brand">${logo(48)} <span>DE MOL</span> <span class="muted" style="letter-spacing:0;font-weight:600">· ${esc(S.name)}</span></div>
    <div class="scode muted">Doe mee: <b style="color:var(--text)">${esc(location.host)}</b> · code <span class="joincode">${esc(S.code)}</span></div></div>`;
  const alive = S.players.filter(p => !p.eliminated);
  const lastMi = S.molinfo[S.molinfo.length - 1];
  let body = '';
  if (v === 'lobby') {
    body = `<div class="finale-stage"><div class="lg muted">Surf naar</div><div class="xl">${esc(location.host)}</div>
      <div class="lg muted">en geef deze code in</div><div class="huge"><span class="joincode">${esc(S.code)}</span></div>
      <div class="pgrid" style="width:100%;margin-top:3vh">${S.players.map(p => `<div class="pcard">${esc(p.name)}</div>`).join('')}</div></div>`;
  } else if (v === 'pot') {
    body = `<div class="finale-stage"><div class="xl muted">IN DE POT</div><div class="huge money">${euro(S.pot)}</div>
      <div class="lg">${S.potLog.slice(-4).reverse().map(e => `<div><span class="money">${e.amount > 0 ? '+' : ''}${euro(e.amount)}</span> <span class="muted">${esc(e.reason)}</span></div>`).join('')}</div></div>`;
  } else if (v === 'molinfo') {
    body = `<div class="finale-stage">${lastMi ? `<div class="xl" style="color:var(--blue)">🕵️ ${esc(lastMi.title || 'MOLINFO')}</div><div class="xl" style="max-width:80vw;white-space:pre-wrap">${esc(lastMi.text)}</div>` : '<div class="xl muted">Nog geen molinfo</div>'}</div>`;
  } else if (v === 'test') {
    const t = S.tests.find(x => x.status === 'open') || S.tests.find(x => x.id === S.screen.testId);
    if (t) {
      const done = t.participants.filter(p => p.submitted).length;
      body = `<div class="finale-stage"><div class="huge">${esc(t.title)}</div>
        <div class="xl">${t.status === 'open' ? `${done} / ${t.participants.length} ingediend` : 'De test is afgesloten'}</div>
        <div class="pgrid" style="width:100%">${t.participants.map(p => `<div class="pcard ${p.submitted ? 'done' : ''}">${esc(p.name)}${p.submitted ? '<span class="chk">✓</span>' : ''}</div>`).join('')}</div></div>`;
    } else body = '<div class="finale-stage"><div class="xl muted">Geen test bezig</div></div>';
  } else if (v === 'finale') {
    const f = S.finale;
    body = `<div class="finale-stage">
      ${!f || (!f.revealedWinner && !f.revealedMole) ? `<div class="huge pulse">DE FINALE</div><div class="xl muted">Wie is de mol?</div><div class="xl money">${euro(S.pot)}</div>` : ''}
      ${f && f.revealedWinner ? `<div class="lg muted">De winnaar van ${euro(S.pot)} is…</div><div class="who gold">${esc(f.winnerName)}</div>` : ''}
      ${f && f.revealedMole ? `<div class="lg muted" style="margin-top:3vh">De mol is…</div><div class="who red">${esc(f.moleName)}</div>
        ${f.suspicion && f.suspicion.length ? `<div class="panel" style="min-width:40vw"><div class="lg" style="margin-bottom:1vh">Meest verdacht volgens de molboekjes</div>
          ${f.suspicion.map(s => `<div class="sus-row lg"><span>${esc(s.name)}</span><div class="sus-bar"><div style="width:${s.avg}%"></div></div><span>${s.avg}%</span></div>`).join('')}</div>` : ''}` : ''}
    </div>`;
  } else {
    body = `<div class="cols">
      <div class="panel"><div class="lg muted" style="margin-bottom:1.5vh">NOG IN HET SPEL (${alive.length})</div>
        <div class="pgrid">${S.players.map(p => `<div class="pcard ${p.eliminated ? 'out' : ''}">${esc(p.name)}</div>`).join('')}</div></div>
      <div style="display:flex;flex-direction:column;gap:2vw">
        <div class="panel center"><div class="lg muted">IN DE POT</div><div class="huge money" style="font-size:clamp(3rem,7vw,7rem)">${euro(S.pot)}</div></div>
        ${lastMi ? `<div class="panel"><div class="lg" style="color:var(--blue);margin-bottom:1vh">🕵️ ${esc(lastMi.title || 'Laatste molinfo')}</div><div class="mi" style="white-space:pre-wrap">${esc(lastMi.text)}</div></div>` : ''}
        ${S.opdrachten.length ? `<div class="panel"><div class="lg muted" style="margin-bottom:1vh">OPDRACHTEN</div>${S.opdrachten.slice(-5).map(o => `<div class="row lg" style="justify-content:space-between"><span>${esc(o.title)}</span><span class="money">${o.earned != null ? euro(o.earned) + ' / ' : ''}${euro(o.maxAmount)}</span></div>`).join('')}</div>` : ''}
      </div></div>`;
  }
  return `<div class="screen">${head}${body}</div>`;
}

// ---------- Events ----------
const A = {
  home() { go('#/'); },
  copy(b) { copy(b.dataset.text); },
  createLobby() {
    socket.emit('host:create', { name: val('h-lname') }, res => {
      if (!res.ok) return toast(res.error, true);
      LS.set('demol:host:' + res.code, res.hostToken); addRecent(res.code, 'host', val('h-lname'));
      go('#/host/' + res.code);
    });
  },
  resumeHost() {
    const code = val('h-rcode').toUpperCase(), t = val('h-rtoken');
    if (!code || !t) return toast('Vul code en spelleidercode in', true);
    LS.set('demol:host:' + code, t); go('#/host/' + code);
  },
  hostLogin(b) { const t = val('hl-token'); if (!t) return; LS.set('demol:host:' + b.dataset.code, t); joinError = null; doJoin(); render(); },
  openScreen() { const c = val('h-scode').toUpperCase(); if (c.length !== 4) return toast('Geef een geldige code in', true); go('#/screen/' + c); },
  openRecent(b) { go(`#/${b.dataset.role === 'player' ? 'play' : b.dataset.role}/${b.dataset.code}`); },
  joinPlayer() { joinAsPlayer(val('h-code').toUpperCase(), val('h-name'), val('h-pin')); },
  joinPlayer2(b) { joinAsPlayer(b.dataset.code, val('pj-name'), val('pj-pin')); },

  // spelleider
  hostTab(b) { ui.hostTab = b.dataset.tab; render(); window.scrollTo(0, 0); },
  toggleShowMole() { ui.showMole = !ui.showMole; render(); },
  setMole() { const v = val('mole-select'); if (!v) return toast('Kies een speler', true); act('setMole', { playerId: v }).then(r => r.ok && toast('Mol ingesteld')); },
  randomMole() { act('setMole', { playerId: 'random' }).then(r => r.ok && toast('🎲 Er is een willekeurige mol gekozen')); },
  startGame() { if (confirm('Spel starten? Elke speler krijgt nu zijn rol te zien.')) act('startGame'); },
  backToLobby() { if (confirm('Terug naar de lobbyfase? Spelers zien opnieuw het wachtscherm.')) act('backToLobby'); },
  pAdj(b) { const p = S.playersFull.find(x => x.id === b.dataset.id); act('updatePlayer', { playerId: p.id, [b.dataset.f]: p[b.dataset.f] + Number(b.dataset.d) }); },
  renamePlayer(b) { const p = S.playersFull.find(x => x.id === b.dataset.id); const n = prompt('Nieuwe naam', p.name); if (n) act('updatePlayer', { playerId: p.id, name: n }); },
  toggleElim(b) { const p = S.playersFull.find(x => x.id === b.dataset.id); act('updatePlayer', { playerId: p.id, eliminated: !p.eliminated }); },
  removePlayer(b) { if (confirm('Speler verwijderen uit de lobby?')) act('removePlayer', { playerId: b.dataset.id }); },
  addPlayer() { const n = val('add-player'); if (!n) return; act('addPlayerManual', { name: n }).then(r => r.ok && clear('add-player')); },
  deleteLobby() { if (confirm('Lobby en alle gegevens definitief verwijderen?')) socket.emit('host:deleteLobby', {}, r => { if (r.ok) { LS.del('demol:host:' + S.code); go('#/'); } }); },
  potAdd(b) { const a = Math.abs(parseInt(val('pot-amount'), 10) || 0) * Number(b.dataset.sign); if (!a) return toast('Vul een bedrag in', true); act('potAdd', { amount: a, reason: val('pot-reason') }).then(r => r.ok && clear('pot-amount', 'pot-reason')); },
  potRemove(b) { act('potRemove', { id: b.dataset.id }); },
  opAdd() { act('opdrachtAdd', { title: val('op-title'), description: val('op-desc'), maxAmount: val('op-max'), molOpdracht: val('op-mol') }).then(r => r.ok && clear('op-title', 'op-desc', 'op-max', 'op-mol')); },
  opResult(b) { const v = val('op-earn-' + b.dataset.id); if (v === '') return toast('Vul het verdiende bedrag in', true); act('opdrachtResult', { id: b.dataset.id, earned: v }).then(r => r.ok && (clear('op-earn-' + b.dataset.id), toast('💰 In de pot!'))); },
  opDelete(b) { if (confirm('Opdracht verwijderen? (Het verdiende bedrag gaat ook uit de pot.)')) act('opdrachtDelete', { id: b.dataset.id }); },
  miSend() { act('molinfoSend', { title: val('mi-title'), text: val('mi-text'), target: val('mi-target') }).then(r => r.ok && (clear('mi-title', 'mi-text'), toast('Molinfo verstuurd'))); },
  miDelete(b) { act('molinfoDelete', { id: b.dataset.id }); },
  selTest(b) { ui.testId = b.dataset.id; render(); },
  testCreate() { act('testCreate', { title: val('new-test') }).then(r => { if (r.ok) { clear('new-test'); ui.testId = null; render(); } }); },
  testDelete(b) { if (confirm('Test verwijderen?')) act('testDelete', { id: b.dataset.id }); },
  testOpen(b) { if (confirm('Test openen? Spelers kunnen dan beginnen en vragen zijn niet meer aan te passen.')) act('testOpen', { id: b.dataset.id }); },
  testClose(b) {
    const t = S.testsFull.find(x => x.id === b.dataset.id);
    const missing = t.participants.filter(pid => !(t.answers[pid] && t.answers[pid].submittedAt)).length;
    if (confirm(missing ? `${missing} speler(s) hebben nog niet ingediend (score 0). Toch sluiten?` : 'Test sluiten en uitslag berekenen?')) act('testClose', { id: b.dataset.id });
  },
  testReopen(b) { act('testReopen', { id: b.dataset.id }); },
  qAdd(b) {
    const opts = val('q-opts').split('\n').map(s => s.trim()).filter(Boolean);
    act('questionAdd', { testId: b.dataset.t, text: val('q-text'), options: opts, correct: null }).then(r => r.ok && clear('q-text', 'q-opts'));
  },
  qDelete(b) { act('questionDelete', { testId: b.dataset.t, qid: b.dataset.q }); },
  qMove(b) { act('questionMove', { testId: b.dataset.t, qid: b.dataset.q, dir: Number(b.dataset.d) }); },
  execStart(b) { act('executionStart', { testId: b.dataset.id }).then(r => { if (r.ok) { ui.hostTab = 'executie'; render(); } }); },
  execNext() { act('executionNext'); },
  execFinish() { act('executionFinish'); },
  execCancel() { if (confirm('Executie annuleren? Een eventueel geëxecuteerde speler wordt teruggehaald.')) act('executionCancel'); },
  finaleSet(b) { act('finaleSet', { testId: b.dataset.id }).then(r => { if (r.ok) { ui.hostTab = 'finale'; render(); } }); },
  finaleReveal(b) { act('finaleReveal', { what: b.dataset.what }); },
  finaleReset() { if (confirm('Finale resetten?')) act('finaleReset'); },

  // speler
  pTab(b) { ui.playerTab = b.dataset.tab; if (ui.playerTab === 'molinfo') markMolinfoSeen(); lastHtml = ''; render(); window.scrollTo(0, 0); },
  revealRole() { ui.roleRevealed = true; vibrate(120); render(); },
  roleSeen() { ui.roleRevealed = false; act('roleSeen'); },
  dismissExec(b) { ui.execDismissed = b.dataset.key; render(); },
  noteAdd() { const t = val('nb-text'); if (!t) return; act('noteAdd', { text: t, tag: val('nb-tag') }).then(r => r.ok && clear('nb-text')); },
  noteDelete(b) { if (confirm('Notitie verwijderen?')) act('noteDelete', { id: b.dataset.id }); },
  testStart(b) { act('testStart', { testId: b.dataset.id }); },
  answer(b) {
    const d = ui.draft[b.dataset.t]; d.answers[Number(b.dataset.i)] = Number(b.dataset.o);
    LS.set('demol:draft:' + b.dataset.t, d); render();
  },
  jokerAdj(b) { const d = ui.draft[b.dataset.t]; d.jokers = Math.max(0, Math.min(S.me.jokers, d.jokers + Number(b.dataset.d))); LS.set('demol:draft:' + b.dataset.t, d); render(); },
  testSubmit(b) {
    const d = ui.draft[b.dataset.t];
    if (!confirm('Test definitief indienen?')) return;
    act('testSubmit', { testId: b.dataset.t, answers: d.answers, jokersUsed: d.jokers }).then(r => { if (r.ok) { LS.del('demol:draft:' + b.dataset.t); toast('Ingediend ✓'); } });
  },
};
function joinAsPlayer(code, name, pinv) {
  if (code.length !== 4) return toast('Geef een geldige lobbycode in', true);
  if (!name) return toast('Geef je naam in', true);
  socket.emit('join:player', { code, name, pin: pinv }, res => {
    if (!res.ok) { if (res.needPin) { ui.needPin = true; lastHtml = ''; render(); } return toast(res.error, true); }
    ui.needPin = false;
    LS.set('demol:player:' + res.code, res.token); addRecent(res.code, 'player', name);
    if (location.hash === '#/play/' + res.code) { joinError = null; doJoin(); render(); } else go('#/play/' + res.code);
  });
}

const C = {
  screenView(el) { act('screenView', { view: el.value }); },
  lock(el) { act('lock', { locked: el.checked }); },
  opStatus(el) { act('opdrachtUpdate', { id: el.dataset.id, status: el.value }); },
  miTemplate(el) {
    if (el.value === '') return;
    const t = MI_TEMPLATES[Number(el.value)];
    document.getElementById('mi-text').value = t[0];
    document.getElementById('mi-target').value = t[1];
    el.value = '';
  },
  qBank(el) {
    if (el.value === '') return;
    const b = QBANK[Number(el.value)];
    document.getElementById('q-text').value = b[0];
    document.getElementById('q-opts').value = b[1].join('\n');
    el.value = '';
  },
  setCorrect(el) { act('questionUpdate', { testId: el.dataset.t, qid: el.dataset.q, correct: el.value === '' ? null : Number(el.value) }); },
  sus(el) { act('suspicion', { targetId: el.dataset.id, value: el.value }); },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]');
  if (!b || b.disabled) return;
  const fn = A[b.dataset.a];
  if (fn) { e.preventDefault(); fn(b, e); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-c]');
  if (el && C[el.dataset.c]) C[el.dataset.c](el, e);
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.c === 'sus') { const s = el.parentElement.querySelector('span.small'); if (s) s.textContent = el.value + '%'; }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  const map = { 'h-name': 'joinPlayer', 'h-code': 'joinPlayer', 'h-pin': 'joinPlayer', 'pj-name': 'joinPlayer2', 'pj-pin': 'joinPlayer2', 'h-scode': 'openScreen', 'h-lname': 'createLobby', 'add-player': 'addPlayer', 'new-test': 'testCreate', 'hl-token': 'hostLogin' };
  const a = map[e.target.id]; if (!a) return;
  const btn = document.querySelector(`[data-a="${a}"]`); if (btn) btn.click();
});
// Ingedrukt houden om je rol te zien
const holdOn = e => { const h = e.target.closest('[data-hold="role"]'); if (!h) return; e.preventDefault(); ui.holdRole = true; render(); };
const holdOff = () => { if (ui.holdRole) { ui.holdRole = false; render(); } };
document.addEventListener('pointerdown', holdOn);
document.addEventListener('pointerup', holdOff);
document.addEventListener('pointercancel', holdOff);
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-hold]')) e.preventDefault(); });

// Executie-toetsen op het hoofdscherm / spelleider: spatie = volgende naam
document.addEventListener('keydown', e => {
  if (S && S.role === 'host' && ui.hostTab === 'executie' && e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    e.preventDefault(); if (S.execution && !S.execution.done) A.execNext();
  }
});

render();
