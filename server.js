// De Mol – zelf spelen. Server met lobby's, realtime sync en opslag op schijf.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'lobbies.json');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- Opslag ----------
let lobbies = {};
try {
  if (fs.existsSync(DATA_FILE)) lobbies = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) { console.error('Kon data niet laden:', e.message); }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(lobbies, null, 1));
    fs.renameSync(tmp, DATA_FILE);
  }, 300);
}

// ---------- Helpers ----------
const uid = () => crypto.randomBytes(6).toString('hex');
const token = () => crypto.randomBytes(16).toString('hex');
const pin = () => String(Math.floor(1000 + Math.random() * 9000));
function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); }
  while (lobbies[c]);
  return c;
}
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const clampInt = (v, min, max) => Math.max(min, Math.min(max, parseInt(v, 10) || 0));
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

function getPlayer(lobby, id) { return lobby.players.find(p => p.id === id); }
function activePlayers(lobby) { return lobby.players.filter(p => !p.eliminated); }
function ensureNotebook(lobby, pid) {
  if (!lobby.notebooks[pid]) lobby.notebooks[pid] = { notes: [], suspicion: {} };
  return lobby.notebooks[pid];
}
function recalcPot(lobby) { lobby.pot = lobby.potLog.reduce((s, e) => s + e.amount, 0); }

function createLobby(name) {
  const code = newCode();
  lobbies[code] = {
    code, name: str(name, 60) || 'De Mol', createdAt: Date.now(),
    hostToken: token(), phase: 'lobby', locked: false,
    players: [], moleId: null,
    pot: 0, potLog: [],
    opdrachten: [], molinfo: [], notebooks: {}, tests: [],
    screen: { view: 'dashboard' },
    finale: null,
  };
  save();
  return lobbies[code];
}

// ---------- Test scoring ----------
function correctIndex(lobby, test, q, qi) {
  if (q.type === 'wiemol') return q.optionIds ? q.optionIds.indexOf(lobby.moleId) : -1;
  if (q.correct !== null && q.correct !== undefined && q.correct !== '') return q.correct;
  const moleAns = test.answers[lobby.moleId];
  if (moleAns && moleAns.answers[qi] !== undefined && moleAns.answers[qi] !== null) return moleAns.answers[qi];
  return -1;
}

function computeResults(lobby, test) {
  const participants = test.participants || [];
  const ranking = participants.map(pid => {
    const p = getPlayer(lobby, pid);
    const a = test.answers[pid];
    let correct = 0, wrong = 0;
    const perQ = test.questions.map((q, qi) => {
      const ci = correctIndex(lobby, test, q, qi);
      const given = a ? a.answers[qi] : null;
      const ok = given !== null && given !== undefined && ci !== -1 && given === ci;
      if (ok) correct++; else wrong++;
      return ok;
    });
    const jokersUsed = a ? Math.min(a.jokersUsed || 0, wrong) : 0;
    return {
      playerId: pid, name: p ? p.name : '?',
      correct, jokersUsed, score: correct + jokersUsed,
      durationMs: a && a.submittedAt ? a.durationMs : null,
      submitted: !!(a && a.submittedAt),
      exempt: (test.exemptIds || []).includes(pid),
      isMole: pid === lobby.moleId,
      perQ,
    };
  });
  // Sorteer: hoogste score eerst, bij gelijk: snelste eerst. Niet ingediend = traagst.
  const dur = r => (r.durationMs == null ? Infinity : r.durationMs);
  ranking.sort((x, y) => (y.score - x.score) || (dur(x) - dur(y)));
  const candidates = ranking.filter(r => !r.isMole && !r.exempt && p_exists(lobby, r.playerId));
  const loser = candidates.length ? candidates[candidates.length - 1] : null;
  const unresolved = test.questions.map((q, qi) => correctIndex(lobby, test, q, qi) === -1 ? qi : null).filter(x => x !== null);
  test.results = { ranking, eliminatedId: loser ? loser.playerId : null, unresolved, computedAt: Date.now() };
}
function p_exists(lobby, id) { return !!getPlayer(lobby, id); }

function computeFinale(lobby, test) {
  if (!test.results) computeResults(lobby, test);
  const nonMole = test.results.ranking.filter(r => !r.isMole);
  lobby.finale = {
    testId: test.id,
    winnerId: nonMole.length ? nonMole[0].playerId : null,
    revealedWinner: false, revealedMole: false,
  };
}

// ---------- Views (wat elke rol mag zien) ----------
function publicPlayers(lobby) {
  return lobby.players.map(p => ({ id: p.id, name: p.name, eliminated: p.eliminated, eliminatedIn: p.eliminatedIn, online: !!p.online }));
}
function execView(lobby) {
  const t = lobby.tests.find(x => x.execution && !x.execution.finished);
  if (!t) return null;
  const ex = t.execution;
  const shown = ex.order.slice(0, ex.revealed).map(pid => ({
    playerId: pid, name: (getPlayer(lobby, pid) || {}).name || '?',
    red: pid === t.results.eliminatedId,
  }));
  return {
    testId: t.id, testTitle: t.title, total: ex.order.length, revealed: ex.revealed,
    shown, current: shown[shown.length - 1] || null, done: ex.done,
  };
}
function testPublic(lobby, t) {
  return {
    id: t.id, title: t.title, status: t.status,
    questionCount: t.questions.length,
    participants: (t.participants || []).map(pid => ({
      id: pid, name: (getPlayer(lobby, pid) || {}).name || '?',
      submitted: !!(t.answers[pid] && t.answers[pid].submittedAt),
    })),
  };
}
function finalePublic(lobby) {
  if (!lobby.finale) return null;
  const f = lobby.finale;
  const mole = getPlayer(lobby, lobby.moleId);
  const winner = getPlayer(lobby, f.winnerId);
  return {
    revealedWinner: f.revealedWinner, revealedMole: f.revealedMole,
    winnerName: f.revealedWinner && winner ? winner.name : null,
    winnerId: f.revealedWinner ? f.winnerId : null,
    moleName: f.revealedMole && mole ? mole.name : null,
    moleId: f.revealedMole ? lobby.moleId : null,
    suspicion: f.revealedMole ? suspicionStats(lobby) : null,
  };
}
function suspicionStats(lobby) {
  return lobby.players.map(p => {
    const vals = Object.entries(lobby.notebooks).filter(([owner]) => owner !== p.id)
      .map(([, nb]) => nb.suspicion[p.id]).filter(v => typeof v === 'number');
    return { name: p.name, avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0 };
  }).filter(x => x.avg > 0).sort((a, b) => b.avg - a.avg).slice(0, 5);
}

function baseView(lobby) {
  return {
    code: lobby.code, name: lobby.name, phase: lobby.phase, locked: lobby.locked,
    players: publicPlayers(lobby), pot: lobby.pot,
    potLog: lobby.potLog.slice(-30),
    screen: lobby.screen,
    execution: execView(lobby),
    finale: finalePublic(lobby),
    tests: lobby.tests.map(t => testPublic(lobby, t)),
  };
}

function hostView(lobby) {
  return {
    ...baseView(lobby), role: 'host',
    hostToken: lobby.hostToken,
    playersFull: lobby.players.map(p => ({ ...p, token: undefined })),
    moleId: lobby.moleId,
    potLog: lobby.potLog,
    opdrachten: lobby.opdrachten,
    molinfo: lobby.molinfo,
    testsFull: lobby.tests,
    finaleFull: lobby.finale,
  };
}

function playerView(lobby, pid) {
  const me = getPlayer(lobby, pid);
  if (!me) return { removed: true };
  const isMole = lobby.phase !== 'lobby' && lobby.moleId === pid;
  const nb = ensureNotebook(lobby, pid);
  const tests = lobby.tests.filter(t => t.status !== 'concept').map(t => {
    const mine = t.answers[pid];
    const part = (t.participants || []).includes(pid);
    const out = {
      id: t.id, title: t.title, status: t.status, participant: part,
      submitted: !!(mine && mine.submittedAt), started: !!(mine && mine.startedAt),
    };
    if (t.status === 'open' && part && !out.submitted) {
      out.questions = t.questions.map(q => ({ id: q.id, text: q.text, options: q.options, type: q.type }));
    }
    return out;
  });
  const exec = execView(lobby);
  let myExec = null;
  if (exec) {
    const s = exec.shown.find(x => x.playerId === pid);
    if (s) myExec = { red: s.red, isCurrent: exec.current && exec.current.playerId === pid };
  }
  return {
    ...baseView(lobby), role: 'player',
    me: { id: me.id, name: me.name, pin: me.pin, eliminated: me.eliminated, jokers: me.jokers, exemptions: me.exemptions, roleSeen: me.roleSeen, isMole },
    tests, myExec,
    opdrachten: lobby.opdrachten.map(o => ({
      id: o.id, title: o.title, description: o.description, maxAmount: o.maxAmount,
      earned: o.earned, status: o.status,
      molOpdracht: isMole ? o.molOpdracht : undefined,
    })),
    molinfo: lobby.molinfo.filter(m => m.target === 'all' || m.target === pid || (m.target === 'mole' && isMole)),
    notebook: nb,
  };
}

function screenView(lobby) {
  return {
    ...baseView(lobby), role: 'screen',
    molinfo: lobby.molinfo.filter(m => m.target === 'all').slice(-5),
    opdrachten: lobby.opdrachten.map(o => ({ id: o.id, title: o.title, maxAmount: o.maxAmount, earned: o.earned, status: o.status })),
  };
}

function broadcast(lobby) {
  save();
  const room = io.sockets.adapter.rooms.get('lobby:' + lobby.code);
  if (!room) return;
  for (const sid of room) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    const d = s.data;
    if (d.role === 'host') s.emit('state', hostView(lobby));
    else if (d.role === 'player') s.emit('state', playerView(lobby, d.playerId));
    else if (d.role === 'screen') s.emit('state', screenView(lobby));
  }
}

function updateOnline(lobby) {
  const room = io.sockets.adapter.rooms.get('lobby:' + lobby.code) || new Set();
  const online = new Set();
  for (const sid of room) {
    const s = io.sockets.sockets.get(sid);
    if (s && s.data.role === 'player') online.add(s.data.playerId);
  }
  lobby.players.forEach(p => { p.online = online.has(p.id); });
}

// ---------- Host acties ----------
const hostActions = {
  setName(l, { name }) { l.name = str(name, 60) || l.name; },
  lock(l, { locked }) { l.locked = !!locked; },
  setMole(l, { playerId }) {
    if (playerId === 'random') {
      const pool = activePlayers(l);
      if (!pool.length) throw new Error('Nog geen spelers');
      l.moleId = pool[Math.floor(Math.random() * pool.length)].id;
    } else {
      if (!getPlayer(l, playerId)) throw new Error('Speler bestaat niet');
      l.moleId = playerId;
    }
  },
  startGame(l) {
    if (l.players.length < 2) throw new Error('Minstens 2 spelers nodig');
    if (!l.moleId) throw new Error('Kies eerst een mol');
    l.phase = 'spel'; l.locked = true;
    l.players.forEach(p => { p.roleSeen = false; });
  },
  backToLobby(l) { l.phase = 'lobby'; },
  removePlayer(l, { playerId }) {
    l.players = l.players.filter(p => p.id !== playerId);
    if (l.moleId === playerId) l.moleId = null;
    delete l.notebooks[playerId];
  },
  updatePlayer(l, { playerId, name, jokers, exemptions, eliminated }) {
    const p = getPlayer(l, playerId); if (!p) throw new Error('Speler bestaat niet');
    if (name !== undefined) p.name = str(name, 30) || p.name;
    if (jokers !== undefined) p.jokers = clampInt(jokers, 0, 99);
    if (exemptions !== undefined) p.exemptions = clampInt(exemptions, 0, 9);
    if (eliminated !== undefined) { p.eliminated = !!eliminated; if (!p.eliminated) p.eliminatedIn = null; }
  },
  addPlayerManual(l, { name }) {
    name = str(name, 30); if (!name) throw new Error('Naam ontbreekt');
    if (l.players.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('Naam bestaat al');
    l.players.push({ id: uid(), token: token(), pin: pin(), name, eliminated: false, eliminatedIn: null, jokers: 0, exemptions: 0, roleSeen: false, joinedAt: Date.now() });
  },
  potAdd(l, { amount, reason }) {
    const a = parseInt(amount, 10); if (!a) throw new Error('Bedrag ontbreekt');
    l.potLog.push({ id: uid(), amount: a, reason: str(reason, 120) || (a > 0 ? 'Geld bijgevoegd' : 'Geld afgenomen'), ts: Date.now() });
    recalcPot(l);
  },
  potRemove(l, { id }) {
    l.potLog = l.potLog.filter(e => e.id !== id);
    l.opdrachten.forEach(o => { if (o.potEntryId === id) { o.potEntryId = null; o.earned = null; o.status = 'bezig'; } });
    recalcPot(l);
  },
  opdrachtAdd(l, { title, description, maxAmount, molOpdracht }) {
    title = str(title, 100); if (!title) throw new Error('Titel ontbreekt');
    l.opdrachten.push({ id: uid(), title, description: str(description, 1000), maxAmount: clampInt(maxAmount, 0, 1e7), molOpdracht: str(molOpdracht, 1000), status: 'gepland', earned: null, potEntryId: null, createdAt: Date.now() });
  },
  opdrachtUpdate(l, { id, title, description, maxAmount, molOpdracht, status }) {
    const o = l.opdrachten.find(x => x.id === id); if (!o) throw new Error('Opdracht niet gevonden');
    if (title !== undefined) o.title = str(title, 100) || o.title;
    if (description !== undefined) o.description = str(description, 1000);
    if (maxAmount !== undefined) o.maxAmount = clampInt(maxAmount, 0, 1e7);
    if (molOpdracht !== undefined) o.molOpdracht = str(molOpdracht, 1000);
    if (status !== undefined && ['gepland', 'bezig', 'klaar'].includes(status)) o.status = status;
  },
  opdrachtResult(l, { id, earned }) {
    const o = l.opdrachten.find(x => x.id === id); if (!o) throw new Error('Opdracht niet gevonden');
    const e = clampInt(earned, 0, 1e7);
    if (o.potEntryId) l.potLog = l.potLog.filter(x => x.id !== o.potEntryId);
    const entry = { id: uid(), amount: e, reason: `Opdracht: ${o.title}`, ts: Date.now(), opdrachtId: o.id };
    l.potLog.push(entry);
    o.potEntryId = entry.id; o.earned = e; o.status = 'klaar';
    recalcPot(l);
  },
  opdrachtDelete(l, { id }) {
    const o = l.opdrachten.find(x => x.id === id);
    if (o && o.potEntryId) l.potLog = l.potLog.filter(x => x.id !== o.potEntryId);
    l.opdrachten = l.opdrachten.filter(x => x.id !== id);
    recalcPot(l);
  },
  molinfoSend(l, { title, text, target }) {
    text = str(text, 2000); if (!text) throw new Error('Tekst ontbreekt');
    if (target !== 'all' && target !== 'mole' && !getPlayer(l, target)) throw new Error('Ongeldige ontvanger');
    l.molinfo.push({ id: uid(), title: str(title, 100), text, target, ts: Date.now() });
  },
  molinfoDelete(l, { id }) { l.molinfo = l.molinfo.filter(m => m.id !== id); },

  testCreate(l, { title }) {
    const n = l.tests.length + 1;
    l.tests.push({
      id: uid(), title: str(title, 80) || `Test ${n}`, status: 'concept', createdAt: Date.now(),
      questions: [{ id: uid(), type: 'wiemol', text: 'Wie is de mol?', options: [], correct: null }],
      answers: {}, participants: [], exemptIds: [], results: null, execution: null,
    });
  },
  testUpdate(l, { id, title }) {
    const t = l.tests.find(x => x.id === id); if (!t) throw new Error('Test niet gevonden');
    if (title !== undefined) t.title = str(title, 80) || t.title;
  },
  testDelete(l, { id }) {
    const t = l.tests.find(x => x.id === id);
    if (t && t.execution && !t.execution.finished && t.execution.revealed > 0) throw new Error('Executie is bezig');
    l.tests = l.tests.filter(x => x.id !== id);
    if (l.finale && l.finale.testId === id) l.finale = null;
  },
  questionAdd(l, { testId, text, options, correct }) {
    const t = l.tests.find(x => x.id === testId); if (!t) throw new Error('Test niet gevonden');
    if (t.status !== 'concept') throw new Error('Test is al gestart');
    text = str(text, 300); if (!text) throw new Error('Vraag ontbreekt');
    const opts = (Array.isArray(options) ? options : []).map(o => str(o, 120)).filter(Boolean).slice(0, 12);
    if (opts.length < 2) throw new Error('Minstens 2 antwoordopties');
    let c = correct === null || correct === undefined || correct === '' ? null : clampInt(correct, 0, opts.length - 1);
    t.questions.push({ id: uid(), type: 'normal', text, options: opts, correct: c });
  },
  questionUpdate(l, { testId, qid, text, options, correct }) {
    const t = l.tests.find(x => x.id === testId); if (!t) throw new Error('Test niet gevonden');
    const q = t.questions.find(x => x.id === qid); if (!q) throw new Error('Vraag niet gevonden');
    if (t.status === 'concept' && q.type === 'normal') {
      if (text !== undefined) q.text = str(text, 300) || q.text;
      if (Array.isArray(options)) {
        const opts = options.map(o => str(o, 120)).filter(Boolean).slice(0, 12);
        if (opts.length >= 2) q.options = opts;
      }
    }
    if (correct !== undefined && q.type === 'normal') {
      q.correct = correct === null || correct === '' ? null : clampInt(correct, 0, q.options.length - 1);
      if (t.results) computeResults(l, t);
    }
  },
  questionDelete(l, { testId, qid }) {
    const t = l.tests.find(x => x.id === testId); if (!t) throw new Error('Test niet gevonden');
    if (t.status !== 'concept') throw new Error('Test is al gestart');
    t.questions = t.questions.filter(q => q.id !== qid);
  },
  questionMove(l, { testId, qid, dir }) {
    const t = l.tests.find(x => x.id === testId); if (!t || t.status !== 'concept') return;
    const i = t.questions.findIndex(q => q.id === qid); const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= t.questions.length) return;
    [t.questions[i], t.questions[j]] = [t.questions[j], t.questions[i]];
  },
  testOpen(l, { id }) {
    const t = l.tests.find(x => x.id === id); if (!t) throw new Error('Test niet gevonden');
    if (l.phase === 'lobby') throw new Error('Start eerst het spel');
    if (!t.questions.length) throw new Error('Test heeft geen vragen');
    if (l.tests.some(x => x.status === 'open' && x.id !== id)) throw new Error('Er is al een andere test open');
    const act = activePlayers(l);
    t.participants = act.map(p => p.id);
    t.questions.forEach(q => {
      if (q.type === 'wiemol') { q.options = act.map(p => p.name); q.optionIds = act.map(p => p.id); }
    });
    t.answers = {}; t.results = null; t.execution = null; t.exemptIds = [];
    t.status = 'open'; t.openedAt = Date.now();
    l.screen = { view: 'test', testId: t.id };
  },
  testClose(l, { id }) {
    const t = l.tests.find(x => x.id === id); if (!t) throw new Error('Test niet gevonden');
    if (t.status !== 'open') throw new Error('Test is niet open');
    // Vrijstellingen worden automatisch ingezet
    t.exemptIds = [];
    t.participants.forEach(pid => {
      const p = getPlayer(l, pid);
      if (p && p.exemptions > 0) { p.exemptions--; t.exemptIds.push(pid); }
    });
    t.status = 'gesloten'; t.closedAt = Date.now();
    computeResults(l, t);
  },
  testReopen(l, { id }) {
    const t = l.tests.find(x => x.id === id); if (!t) throw new Error('Test niet gevonden');
    if (t.status !== 'gesloten') throw new Error('Kan enkel een gesloten test heropenen');
    if (t.execution && t.execution.revealed > 0) throw new Error('Executie is al begonnen');
    // geef vrijstellingen terug
    (t.exemptIds || []).forEach(pid => { const p = getPlayer(l, pid); if (p) p.exemptions++; });
    t.exemptIds = []; t.results = null; t.execution = null; t.status = 'open';
  },
  executionStart(l, { testId }) {
    const t = l.tests.find(x => x.id === testId); if (!t) throw new Error('Test niet gevonden');
    if (t.status !== 'gesloten' || !t.results) throw new Error('Sluit eerst de test af');
    if (l.tests.some(x => x.execution && !x.execution.finished && x.id !== testId)) throw new Error('Er loopt al een executie');
    const order = shuffle(t.participants.filter(pid => getPlayer(l, pid)));
    t.execution = { order, revealed: 0, done: false, finished: false, startedAt: Date.now() };
    l.screen = { view: 'execution', testId: t.id };
  },
  executionNext(l) {
    const t = l.tests.find(x => x.execution && !x.execution.finished); if (!t) throw new Error('Geen executie bezig');
    const ex = t.execution; if (ex.done) throw new Error('Executie is afgelopen');
    ex.revealed++;
    const pid = ex.order[ex.revealed - 1];
    if (pid === t.results.eliminatedId) {
      const p = getPlayer(l, pid);
      if (p) { p.eliminated = true; p.eliminatedIn = t.title; }
      ex.done = true;
    } else if (ex.revealed >= ex.order.length) ex.done = true;
  },
  executionFinish(l) {
    const t = l.tests.find(x => x.execution && !x.execution.finished); if (!t) return;
    t.execution.finished = true; t.status = 'geexecuteerd';
    l.screen = { view: 'dashboard' };
  },
  executionCancel(l) {
    const t = l.tests.find(x => x.execution && !x.execution.finished); if (!t) return;
    if (t.execution.done && t.results.eliminatedId) {
      const p = getPlayer(l, t.results.eliminatedId);
      if (p) { p.eliminated = false; p.eliminatedIn = null; }
    }
    t.execution = null; l.screen = { view: 'dashboard' };
  },
  screenView(l, { view, testId }) {
    if (!['dashboard', 'test', 'execution', 'finale', 'pot', 'molinfo', 'lobby'].includes(view)) throw new Error('Onbekende weergave');
    l.screen = { view, testId: testId || null };
  },
  finaleSet(l, { testId }) {
    const t = l.tests.find(x => x.id === testId); if (!t) throw new Error('Test niet gevonden');
    if (!t.results) throw new Error('Deze test heeft nog geen resultaten');
    computeFinale(l, t);
    l.phase = 'finale';
    l.screen = { view: 'finale' };
  },
  finaleReveal(l, { what }) {
    if (!l.finale) throw new Error('Kies eerst de finaletest');
    if (what === 'winner') l.finale.revealedWinner = true;
    if (what === 'mole') l.finale.revealedMole = true;
    l.screen = { view: 'finale' };
  },
  finaleReset(l) { l.finale = null; l.phase = 'spel'; l.screen = { view: 'dashboard' }; },
};

// ---------- Speler acties ----------
const playerActions = {
  roleSeen(l, p) { p.roleSeen = true; },
  noteAdd(l, p, { text, tag }) {
    text = str(text, 2000); if (!text) throw new Error('Lege notitie');
    ensureNotebook(l, p.id).notes.push({ id: uid(), text, tag: str(tag, 60), ts: Date.now() });
  },
  noteDelete(l, p, { id }) {
    const nb = ensureNotebook(l, p.id); nb.notes = nb.notes.filter(n => n.id !== id);
  },
  suspicion(l, p, { targetId, value }) {
    if (!getPlayer(l, targetId)) return;
    ensureNotebook(l, p.id).suspicion[targetId] = clampInt(value, 0, 100);
  },
  testStart(l, p, { testId }) {
    const t = l.tests.find(x => x.id === testId);
    if (!t || t.status !== 'open' || !t.participants.includes(p.id)) throw new Error('Test niet beschikbaar');
    if (!t.answers[p.id]) t.answers[p.id] = { answers: [], jokersUsed: 0, startedAt: Date.now(), submittedAt: null };
  },
  testSubmit(l, p, { testId, answers, jokersUsed }) {
    const t = l.tests.find(x => x.id === testId);
    if (!t || t.status !== 'open' || !t.participants.includes(p.id)) throw new Error('Test niet beschikbaar');
    const a = t.answers[p.id] || { startedAt: t.openedAt };
    if (a.submittedAt) throw new Error('Al ingediend');
    const ans = t.questions.map((q, i) => {
      const v = Array.isArray(answers) ? answers[i] : null;
      return (v === null || v === undefined || v === '') ? null : clampInt(v, 0, q.options.length - 1);
    });
    if (ans.some(v => v === null)) throw new Error('Beantwoord alle vragen');
    const j = Math.min(clampInt(jokersUsed, 0, 99), p.jokers);
    p.jokers -= j;
    const now = Date.now();
    t.answers[p.id] = { answers: ans, jokersUsed: j, startedAt: a.startedAt || t.openedAt, submittedAt: now, durationMs: now - (a.startedAt || t.openedAt) };
  },
};

// ---------- Sockets ----------
io.on('connection', socket => {
  const join = (lobby, role, playerId) => {
    socket.data = { code: lobby.code, role, playerId };
    socket.join('lobby:' + lobby.code);
    updateOnline(lobby);
    broadcast(lobby);
  };
  const reply = (cb, data) => typeof cb === 'function' && cb(data);

  socket.on('host:create', ({ name } = {}, cb) => {
    const l = createLobby(name);
    join(l, 'host');
    reply(cb, { ok: true, code: l.code, hostToken: l.hostToken });
  });
  socket.on('join:host', ({ code, token: t } = {}, cb) => {
    const l = lobbies[String(code || '').toUpperCase()];
    if (!l) return reply(cb, { ok: false, error: 'Lobby niet gevonden' });
    if (l.hostToken !== t) return reply(cb, { ok: false, error: 'Ongeldige spelleidercode' });
    join(l, 'host'); reply(cb, { ok: true, code: l.code, hostToken: l.hostToken });
  });
  socket.on('join:screen', ({ code } = {}, cb) => {
    const l = lobbies[String(code || '').toUpperCase()];
    if (!l) return reply(cb, { ok: false, error: 'Lobby niet gevonden' });
    join(l, 'screen'); reply(cb, { ok: true, code: l.code });
  });
  socket.on('join:player', ({ code, name, pin: pn, token: t } = {}, cb) => {
    const l = lobbies[String(code || '').toUpperCase()];
    if (!l) return reply(cb, { ok: false, error: 'Lobby niet gevonden' });
    let p = null;
    if (t) p = l.players.find(x => x.token === t);
    if (!p && name) {
      name = str(name, 30);
      const existing = l.players.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        if (String(pn || '') === existing.pin) p = existing;
        else return reply(cb, { ok: false, error: 'Deze naam bestaat al. Geef je pincode in om opnieuw in te loggen.', needPin: true });
      } else {
        if (l.locked) return reply(cb, { ok: false, error: 'Deze lobby is vergrendeld' });
        p = { id: uid(), token: token(), pin: pin(), name, eliminated: false, eliminatedIn: null, jokers: 0, exemptions: 0, roleSeen: false, joinedAt: Date.now() };
        l.players.push(p);
      }
    }
    if (!p) return reply(cb, { ok: false, error: 'Geef een naam in' });
    join(l, 'player', p.id);
    reply(cb, { ok: true, code: l.code, token: p.token, playerId: p.id });
  });

  socket.on('host:action', ({ type, ...payload } = {}, cb) => {
    const l = lobbies[socket.data && socket.data.code];
    if (!l || socket.data.role !== 'host') return reply(cb, { ok: false, error: 'Geen toegang' });
    const fn = hostActions[type];
    if (!fn) return reply(cb, { ok: false, error: 'Onbekende actie' });
    try { fn(l, payload || {}); broadcast(l); reply(cb, { ok: true }); }
    catch (e) { reply(cb, { ok: false, error: e.message }); }
  });
  socket.on('player:action', ({ type, ...payload } = {}, cb) => {
    const l = lobbies[socket.data && socket.data.code];
    if (!l || socket.data.role !== 'player') return reply(cb, { ok: false, error: 'Geen toegang' });
    const p = getPlayer(l, socket.data.playerId);
    if (!p) return reply(cb, { ok: false, error: 'Je bent verwijderd uit deze lobby' });
    const fn = playerActions[type];
    if (!fn) return reply(cb, { ok: false, error: 'Onbekende actie' });
    try { fn(l, p, payload || {}); broadcast(l); reply(cb, { ok: true }); }
    catch (e) { reply(cb, { ok: false, error: e.message }); }
  });
  socket.on('host:deleteLobby', (_, cb) => {
    const l = lobbies[socket.data && socket.data.code];
    if (!l || socket.data.role !== 'host') return reply(cb, { ok: false, error: 'Geen toegang' });
    io.to('lobby:' + l.code).emit('lobbyDeleted');
    delete lobbies[l.code]; save(); reply(cb, { ok: true });
  });

  socket.on('disconnect', () => {
    const l = lobbies[socket.data && socket.data.code];
    if (l) { updateOnline(l); broadcast(l); }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`De Mol draait op http://0.0.0.0:${PORT}`));
