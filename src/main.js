import { Chess } from 'chess.js';
import { StockfishEngine, scoreToCp, formatScore } from './engine.js';
import './style.css';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORE_KEY = 'tempo-chess-v1';
const engine = new StockfishEngine();

const state = {
  view: 'overview',
  username: '',
  profile: null,
  games: [],
  selectedGameId: null,
  gameAnalysis: {},
  blunders: [],
  openings: [],
  openingSchedules: {},
  openingDrill: null,
  activeMoveIndex: 0,
  engineReady: false,
  engineStatus: 'Engine sleeping',
  analysisBusy: false,
  importBusy: false,
  importProgress: '',
  importError: '',
  batchBusy: false,
  batchDone: 0,
  batchTotal: 0,
  toast: '',
  demo: true,
  trainingIndex: 0,
  trainingSelected: null,
  trainingMessage: '',
  trainingMode: 'review',
  practice: { chess: new Chess(), selected: null, skill: 8, coach: true, lastMove: null, busy: false, message: 'Choose a white piece, then choose its destination square.', paused: false, hint: '', lastEval: null }
};

const PIECES = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟'
};

function id() { return globalThis.crypto?.randomUUID?.() || `g-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(value) {
  if (!value) return 'Date unknown';
  const d = new Date(value);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeAgo(value) {
  if (!value) return 'Recently';
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return fmtDate(value);
}
function resultLabel(result) {
  return result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Draw';
}
function resultClass(result) { return result === 'win' ? 'positive' : result === 'loss' ? 'negative' : 'neutral'; }
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function toast(message) {
  state.toast = message;
  const node = $('#toast');
  if (node) {
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3000);
  }
}

function save() {
  const payload = {
    username: state.username,
    profile: state.profile,
    games: state.games,
    gameAnalysis: state.gameAnalysis,
    blunders: state.blunders,
    openings: state.openings,
    openingSchedules: state.openingSchedules,
    demo: state.demo
  };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); }
  catch (error) { console.warn('Could not persist Tempo data:', error); }
}

function restore() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!stored) return false;
    Object.assign(state, stored);
    state.games ||= [];
    state.gameAnalysis ||= {};
    state.blunders ||= [];
    state.openings ||= [];
    state.openingSchedules ||= {};
    return true;
  } catch (error) {
    console.warn('Saved data could not be read:', error);
    return false;
  }
}

function getUserColor(game) { return game.userColor || 'w'; }
function userNameFor(game) {
  const color = getUserColor(game);
  return color === 'w' ? game.whiteName : game.blackName;
}
function opponentFor(game) {
  const color = getUserColor(game);
  return color === 'w' ? game.blackName : game.whiteName;
}
function playerOutcome(game) { return game.outcome || 'draw'; }

function parseOnePgn(pgn, meta = {}, username = '') {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.getHeaders();
  const history = chess.history({ verbose: true });
  const user = (username || meta.username || '').toLowerCase();
  const whiteName = headers.White || meta.white?.username || 'White';
  const blackName = headers.Black || meta.black?.username || 'Black';
  let userColor = 'w';
  if (user && blackName.toLowerCase() === user) userColor = 'b';
  else if (user && whiteName.toLowerCase() === user) userColor = 'w';
  else if (meta.userColor) userColor = meta.userColor;
  const result = headers.Result || meta.result || '*';
  let outcome = 'draw';
  if (result === '1-0') outcome = userColor === 'w' ? 'win' : 'loss';
  if (result === '0-1') outcome = userColor === 'b' ? 'win' : 'loss';
  const opened = headers.Opening || meta.opening || '';
  const eco = headers.ECO || meta.eco || '';
  const dateString = headers.UTCDate && headers.UTCDate !== '????.??.??'
    ? headers.UTCDate.replaceAll('.', '-')
    : headers.Date && headers.Date !== '????.??.??' ? headers.Date.replaceAll('.', '-') : null;
  const date = meta.date || (dateString ? new Date(`${dateString}T12:00:00`).toISOString() : null);
  const rating = userColor === 'w' ? Number(meta.white?.rating || headers.WhiteElo || 0) : Number(meta.black?.rating || headers.BlackElo || 0);
  return {
    id: meta.id || id(),
    pgn,
    headers,
    moveCount: history.length,
    date,
    endTime: meta.endTime || null,
    timeClass: meta.timeClass || headers.TimeControl || 'Chess',
    whiteName,
    blackName,
    whiteRating: Number(meta.white?.rating || headers.WhiteElo || 0),
    blackRating: Number(meta.black?.rating || headers.BlackElo || 0),
    rating,
    userColor,
    result: resultLabel(outcome),
    outcome,
    opening: opened || (eco ? `${eco} · Opening` : guessOpening(history)),
    eco,
    url: meta.url || '',
    accuracy: null,
    moves: history.map(m => ({ san: m.san, color: m.color, from: m.from, to: m.to, piece: m.piece, captured: m.captured || null, promotion: m.promotion || null }))
  };
}

function guessOpening(history) {
  if (!history?.length) return 'Unclassified opening';
  const names = history.slice(0, 6).map(x => x.san).join(' ');
  if (names.startsWith('e4 e5 Nf3 Nc6')) return 'Open Game';
  if (names.startsWith('d4 d5')) return 'Queen’s Pawn Game';
  if (names.startsWith('e4 c5')) return 'Sicilian Defence';
  if (names.startsWith('e4 e6')) return 'French Defence';
  if (names.startsWith('e4 c6')) return 'Caro-Kann Defence';
  if (names.startsWith('Nf3')) return 'Réti Opening';
  return 'Unclassified opening';
}

function splitPgn(text) {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/(?=\[Event\s+")/g).map(x => x.trim()).filter(Boolean);
  return parts.length ? parts : [cleaned];
}

function normaliseChessComGame(game, username) {
  if (!game?.pgn) return null;
  const u = username.toLowerCase();
  const white = game.white || {};
  const black = game.black || {};
  const userColor = String(white.username || '').toLowerCase() === u ? 'w' : 'b';
  return parseOnePgn(game.pgn, {
    id: game.uuid || game.url || id(),
    username,
    userColor,
    white,
    black,
    timeClass: game.time_class || 'Chess',
    endTime: game.end_time ? new Date(game.end_time * 1000).toISOString() : null,
    date: game.end_time ? new Date(game.end_time * 1000).toISOString() : null,
    url: game.url,
    eco: game.eco || ''
  }, username);
}

async function importChessCom(username, monthLimit = 6, gameLimit = 100) {
  const safe = username.trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(safe)) throw new Error('Enter a valid Chess.com username.');
  const profileResponse = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(safe)}`);
  if (!profileResponse.ok) throw new Error(profileResponse.status === 404 ? 'That Chess.com username was not found.' : `Profile request failed (${profileResponse.status}).`);
  const profile = await profileResponse.json();
  let playerStats = {};
  try {
    const statsResponse = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(safe)}/stats`);
    if (statsResponse.ok) playerStats = await statsResponse.json();
  } catch (error) { console.info('Chess.com stats endpoint was not available; continuing with game ratings.'); }
  profile.stats = playerStats;
  profile.rating = playerStats.chess_rapid?.last?.rating || playerStats.chess_blitz?.last?.rating || playerStats.chess_bullet?.last?.rating || null;
  profile.rapidRating = playerStats.chess_rapid?.last?.rating || null;
  profile.blitzRating = playerStats.chess_blitz?.last?.rating || null;
  profile.bulletRating = playerStats.chess_bullet?.last?.rating || null;
  const archivesResponse = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(safe)}/games/archives`);
  if (!archivesResponse.ok) throw new Error(`Could not retrieve game archives (${archivesResponse.status}).`);
  const archivesData = await archivesResponse.json();
  const archives = (archivesData.archives || []).slice(-monthLimit).reverse();
  if (!archives.length) return { profile, games: [] };
  const games = [];
  for (let index = 0; index < archives.length; index++) {
    const archiveUrl = archives[index];
    const res = await fetch(archiveUrl);
    if (res.status === 429) {
      await sleep(1500);
      const retry = await fetch(archiveUrl);
      if (!retry.ok) throw new Error('Chess.com is rate-limiting archive downloads. Please try again shortly or import a PGN file.');
      const body = await retry.json();
      for (const game of (body.games || [])) {
        if (game.rules && game.rules !== 'chess') continue;
        try { const parsed = normaliseChessComGame(game, safe); if (parsed) games.push(parsed); }
        catch (error) { console.info('Skipping a game that could not be parsed:', error); }
        if (games.length >= gameLimit) break;
      }
    } else {
      if (!res.ok) throw new Error(`Archive download failed (${res.status}).`);
      const body = await res.json();
      for (const game of (body.games || [])) {
        if (game.rules && game.rules !== 'chess') continue;
        try { const parsed = normaliseChessComGame(game, safe); if (parsed) games.push(parsed); }
        catch (error) { console.info('Skipping a game that could not be parsed:', error); }
        if (games.length >= gameLimit) break;
      }
    }
    state.importProgress = `Reading ${index + 1} of ${archives.length} months · ${games.length} games found`;
    renderImportProgress();
    if (games.length >= gameLimit) break;
    if (index < archives.length - 1) await sleep(350);
  }
  games.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return { profile, games: games.slice(0, gameLimit) };
}

function currentStats() {
  const games = state.games;
  const wins = games.filter(g => g.outcome === 'win').length;
  const losses = games.filter(g => g.outcome === 'loss').length;
  const draws = games.length - wins - losses;
  const analysedIds = Object.keys(state.gameAnalysis);
  const analysedGames = analysedIds.length;
  const allMoves = Object.values(state.gameAnalysis).flatMap(a => a.moves || []).filter(m => m.isUserMove);
  const avgAccuracy = allMoves.length
    ? Math.round(allMoves.reduce((sum, m) => sum + (m.accuracy ?? 0), 0) / allMoves.length)
    : null;
  return { games: games.length, wins, losses, draws, winRate: pct(wins, games.length), analysedGames, allMoves, avgAccuracy };
}

function aggregateOpenings() {
  const groups = new Map();
  for (const game of state.games) {
    const key = game.opening || 'Unclassified opening';
    const item = groups.get(key) || { name: key, games: 0, wins: 0, losses: 0, draws: 0, white: 0, black: 0 };
    item.games++;
    if (game.outcome === 'win') item.wins++;
    else if (game.outcome === 'loss') item.losses++;
    else item.draws++;
    if (game.userColor === 'w') item.white++; else item.black++;
    groups.set(key, item);
  }
  return [...groups.values()].sort((a, b) => b.games - a.games);
}

function allMistakes() {
  const fromAnalysis = Object.values(state.gameAnalysis).flatMap(a => a.mistakes || []);
  const unique = new Map();
  for (const m of [...state.blunders, ...fromAnalysis]) unique.set(m.id, m);
  return [...unique.values()].sort((a, b) => Number(b.loss || 0) - Number(a.loss || 0));
}

function getSelectedGame() { return state.games.find(g => g.id === state.selectedGameId) || state.games[0] || null; }

function navItem(key, label, icon, count = null) {
  return `<button class="nav-item ${state.view === key ? 'active' : ''}" data-view="${key}">
    <span class="nav-icon">${icon}</span><span>${label}</span>${count !== null ? `<small>${count}</small>` : ''}
  </button>`;
}

function renderShell() {
  $('#app').innerHTML = `
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">T</div><div><strong>TEMPO</strong><span>CHESS LAB</span></div></div>
      <div class="side-label">WORKSPACE</div>
      <nav class="nav-main">
        ${navItem('overview', 'Overview', '◫')}
        ${navItem('games', 'My games', '▤')}
        ${navItem('analysis', 'Game analysis', '⌁', Object.keys(state.gameAnalysis).length || null)}
        ${navItem('blunders', 'Mistake bank', '♜', allMistakes().length || null)}
      </nav>
      <div class="side-label nav-gap">IMPROVE</div>
      <nav class="nav-main">
        ${navItem('openings', 'Openings', '⌘')}
        ${navItem('training', 'Training room', '♙')}
        ${navItem('insights', 'Player insights', '⌗')}
      </nav>
      <div class="sidebar-bottom">
        <div class="engine-card"><span class="engine-dot ${state.engineReady ? 'online' : ''}"></span><div><b>${escapeHtml(state.engineStatus)}</b><small>Local analysis engine</small></div></div>
        <button class="sidebar-import" data-action="open-import">＋ Connect your games</button>
        <div class="privacy-note"><span>◈</span> Your data stays on this device</div>
      </div>
    </aside>
    <main class="main-shell">
      <header class="topbar">
        <div class="mobile-brand"><div class="brand-mark">T</div><b>TEMPO</b></div>
        <div class="breadcrumbs"><span>Workspace</span><i>/</i><b>${viewTitle(state.view)}</b></div>
        <div class="top-actions"><span class="engine-pill"><span class="engine-dot ${state.engineReady ? 'online' : ''}"></span>${escapeHtml(state.engineStatus)}</span><button class="btn btn-dark" data-action="open-import">＋ Import games</button><div class="avatar">${escapeHtml((state.username || 'S').slice(0,1).toUpperCase())}</div></div>
      </header>
      <section id="view-root"></section>
      <footer class="footer-note">TEMPO IS AN INDEPENDENT CHESS TRAINING TOOL. NOT AFFILIATED WITH CHESS.COM OR THE STOCKFISH PROJECT.</footer>
    </main>
    <nav class="mobile-nav">${navItem('overview', 'Home', '◫')}${navItem('games', 'Games', '▤')}${navItem('blunders', 'Mistakes', '♜')}${navItem('training', 'Train', '♙')}${navItem('insights', 'Insights', '⌗')}</nav>
    <div id="modal-root"></div><div id="toast" class="toast"></div>
  `;
  renderView();
}

function viewTitle(view) {
  return ({ overview: 'Overview', games: 'My games', analysis: 'Game analysis', blunders: 'Mistake bank', openings: 'Openings', training: 'Training room', insights: 'Player insights' })[view] || 'Overview';
}

function pageHeading(title, subtitle, action = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${state.demo ? 'SAMPLE WORKSPACE' : 'YOUR CHESS PROFILE'}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${action}</div></div>`;
}

function demoPanel() {
  return state.demo ? `<div class="demo-banner"><span class="demo-dot"></span><div><b>You're viewing sample data</b><span>Connect your Chess.com username or import a PGN to see your own patterns.</span></div><button data-action="open-import">Import my games <span>↗</span></button></div>` : '';
}

function chartSvg() {
  let vals;
  let labels;
  if (state.demo) {
    vals = [1294, 1308, 1299, 1336, 1328, 1360, 1351, 1393, 1385, 1430, 1425, 1486];
    labels = ['JUN','JUL','AUG','SEP','OCT'];
  } else {
    const rated = state.games.filter(g => g.rating > 0 && g.date).sort((a,b) => new Date(a.date)-new Date(b.date)).slice(-16);
    vals = rated.map(g => g.rating);
    labels = rated.map(g => new Date(g.date).toLocaleDateString(undefined,{month:'short'}).toUpperCase());
  }
  if (!vals?.length) return `<div class="chart-empty">Import games with rating metadata to build your rating timeline.</div>`;
  const min = Math.min(...vals) - 35;
  const max = Math.max(...vals) + 35;
  const x = i => vals.length === 1 ? 290 : 25 + i * (528 / (vals.length - 1));
  const y = v => 155 - ((v-min) / Math.max(1,max-min)) * 110;
  const points = vals.map((v,i) => `${x(i)},${y(v)}`).join(' ');
  const area = `25,155 ${points} 553,155`;
  const labelIdx = [...new Set([0, Math.floor((vals.length-1)/4), Math.floor((vals.length-1)/2), Math.floor(3*(vals.length-1)/4), vals.length-1])];
  return `<svg class="trend-chart" viewBox="0 0 580 190" role="img" aria-label="Player rating trend">
    ${[30,70,110,150].map(y0 => `<line x1="20" y1="${y0}" x2="560" y2="${y0}" class="chart-grid"/>`).join('')}
    <polygon points="${area}" class="chart-area"/><polyline points="${points}" class="chart-line"/>
    ${vals.map((v,i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${vals.length>12?2.5:3.2}" class="chart-point"><title>${v}</title></circle>`).join('')}
    ${labelIdx.map(i => `<text x="${x(i)}" y="180" text-anchor="middle">${escapeHtml(labels[i] || '')}</text>`).join('')}
  </svg>`;
}

function kpiCard(label, value, change, icon, tone = '') {
  return `<article class="kpi-card"><div class="kpi-top"><span>${label}</span><span class="kpi-icon ${tone}">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${change}</div></article>`;
}

function renderOverview() {
  const s = currentStats();
  const mistakes = allMistakes();
  const openings = aggregateOpenings();
  const losses = mistakes.filter(m => m.severity === 'Blunder').length;
  const sampleValues = state.demo ? { games: 42, accuracy: '78%', analysed: '36', win: '54%' } : {
    games: s.games,
    accuracy: s.avgAccuracy === null ? '—' : `${s.avgAccuracy}%`,
    analysed: `${s.analysedGames}`,
    win: `${s.winRate}%`
  };
  const rated = state.profile?.username || state.username;
  const lastGameRating = state.games.find(g => g.rating > 0)?.rating;
  const ratingText = state.profile?.rating ? `${Number(state.profile.rating).toLocaleString()}` : (state.demo ? '1,486' : lastGameRating ? Number(lastGameRating).toLocaleString() : '—');
  $('#view-root').innerHTML = `
    ${demoPanel()}
    ${pageHeading('Your chess, <em>understood.</em>', `A clearer picture of how you play${rated ? `, ${escapeHtml(rated)}` : ''}. Find the patterns. Fix the habits. Keep the rating.`, `<button class="btn btn-outline" data-view="training">Start a study session <span>↗</span></button>`)}
    <div class="kpi-grid">
      ${kpiCard('GAMES IN YOUR LIBRARY', sampleValues.games, state.demo ? '<span class="trend-up">↗ 12%</span> vs. last month' : 'Imported from your game history', '▤')}
      ${kpiCard('AVERAGE MOVE ACCURACY', sampleValues.accuracy, state.demo ? '<span class="trend-up">↗ 3.2%</span> vs. last 30 days' : (s.avgAccuracy === null ? 'Analyse games to calculate' : 'Estimated from engine reviews'), '⌁', 'orange')}
      ${kpiCard('GAMES ANALYSED', sampleValues.analysed, state.demo ? 'Engine reviewed' : 'With Stockfish', '◈', 'green')}
      ${kpiCard('WIN RATE', sampleValues.win, state.demo ? 'Across rated rapid games' : `${s.wins} wins · ${s.losses} losses · ${s.draws} draws`, '♔', 'blue')}
    </div>
    <div class="overview-grid">
      <article class="panel rating-panel">
        <div class="panel-head"><div><span class="eyebrow">PERFORMANCE</span><h2>Rating journey</h2><p>See how your play is developing over time.</p></div><div class="select-chip">Rapid <span>⌄</span></div></div>
        <div class="chart-summary"><strong>${ratingText}</strong><span class="trend-up">${state.demo ? '↗ +86 pts' : (state.profile?.rating ? 'Current Chess.com rating' : 'No rating loaded')}</span></div>
        ${chartSvg()}
        <div class="chart-legend"><span><i></i> Your rating</span><span class="muted">${state.demo ? 'Sample trend · illustrative' : 'Imported game ratings · chronological'}</span></div>
      </article>
      <article class="panel leaks-panel">
        <div class="panel-head"><div><span class="eyebrow">THE BIGGEST LEAKS</span><h2>Where points disappear</h2><p>Patterns worth fixing first.</p></div><button class="icon-button" data-view="insights">↗</button></div>
        ${renderLeakRow('Hanging pieces', 'You leave material en prise', state.demo ? '34%' : leakShare('Hanging piece', mistakes), '♟')}
        ${renderLeakRow('Missed tactics', 'Forks, pins and loose defenders', state.demo ? '27%' : leakShare('Missed tactic', mistakes), '⌁')}
        ${renderLeakRow('Opening decisions', 'Early moves that cost time or space', state.demo ? '19%' : leakShare('Opening choice', mistakes), '♜')}
        <button class="text-link" data-view="insights">Explore all weaknesses <span>→</span></button>
      </article>
    </div>
    <div class="lower-grid">
      <article class="panel recent-panel"><div class="panel-head"><div><span class="eyebrow">YOUR HISTORY</span><h2>Recent games</h2></div><button class="text-link" data-view="games">All games →</button></div>${renderRecentGames(4)}</article>
      <article class="panel plan-panel"><div class="panel-head"><div><span class="eyebrow">YOUR NEXT 15 MINUTES</span><h2>Today's study plan</h2></div><span class="plan-date">TODAY</span></div>
        <div class="plan-step"><span class="step-time">05 MIN</span><span class="step-icon orange">♜</span><div><b>Revisit your biggest blunders</b><small>3 positions from your mistake bank</small></div><span class="step-check">○</span></div>
        <div class="plan-step"><span class="step-time">05 MIN</span><span class="step-icon green">⌘</span><div><b>Opening recall</b><small>${openings[0]?.name || 'Queen’s Pawn'} · 4 key moves</small></div><span class="step-check">○</span></div>
        <div class="plan-step"><span class="step-time">05 MIN</span><span class="step-icon blue">♔</span><div><b>Endgame technique</b><small>Rook and king checkmates</small></div><span class="step-check">○</span></div>
        <button class="btn btn-primary full" data-view="training">Begin today's plan <span>→</span></button>
      </article>
    </div>
  `;
  wireViewButtons();
}

function leakShare(theme, mistakes) {
  if (!mistakes.length) return '—';
  const count = mistakes.filter(m => m.theme === theme).length;
  return `${pct(count, mistakes.length)}%`;
}

function renderLeakRow(title, subtitle, value, icon) {
  return `<div class="leak-row"><span class="leak-icon">${icon}</span><div class="leak-text"><b>${title}</b><small>${subtitle}</small></div><strong>${value}</strong></div>`;
}

function renderRecentGames(limit = 5) {
  const games = state.games.slice(0, limit);
  if (!games.length) return `<div class="empty-state small"><span>♘</span><b>No games yet</b><small>Import your Chess.com history or a PGN file to get started.</small></div>`;
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>OPPONENT</th><th>OPENING</th><th>RESULT</th><th>DATE</th><th></th></tr></thead><tbody>${games.map(g => `<tr>
    <td><div class="opponent-cell"><span class="opponent-avatar">${escapeHtml((opponentFor(g) || '?').slice(0,1).toUpperCase())}</span><div><b>${escapeHtml(opponentFor(g))}</b><small>${escapeHtml(g.rating ? `Rated ${g.rating}` : g.timeClass)}</small></div></div></td>
    <td class="opening-cell">${escapeHtml(g.opening || 'Unclassified')}</td><td><span class="result-pill ${resultClass(g.outcome)}">${resultLabel(g.outcome)}</span></td><td class="date-cell">${fmtDate(g.date)}</td>
    <td><button class="row-arrow" data-action="select-game" data-id="${escapeHtml(g.id)}">↗</button></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function renderGames() {
  $('#view-root').innerHTML = `${demoPanel()}${pageHeading('Your games', 'Every game is a data point. Every mistake is a training opportunity.', `<button class="btn btn-outline" data-action="analyse-batch" ${state.batchBusy || !state.games.length ? 'disabled' : ''}>${state.batchBusy ? 'Analysing…' : 'Analyse next 3'}</button><button class="btn btn-primary" data-action="open-import">＋ Import games</button>`)}
  ${state.batchBusy || state.analysisBusy ? `<div class="analysis-queue-strip"><span>${state.batchBusy ? `Batch analysis · ${state.batchDone} of ${state.batchTotal} games complete` : 'Stockfish is reviewing this game…'}</span><div class="progress-track"><i style="width:${state.batchBusy ? (state.batchDone/Math.max(1,state.batchTotal))*100 : 8}%"></i></div></div>` : ''}
  <div class="toolbar"><div class="search-box"><span>⌕</span><input id="game-search" placeholder="Search opponents or openings…" /></div><div class="toolbar-right"><select id="game-filter"><option value="all">All results</option><option value="win">Wins</option><option value="loss">Losses</option><option value="draw">Draws</option></select><span class="count-label">${state.games.length} GAMES</span></div></div>
  <article class="panel list-panel" id="games-list">${renderRecentGames(100)}</article>`;
  wireViewButtons();
  $('#game-search')?.addEventListener('input', filterGames);
  $('#game-filter')?.addEventListener('change', filterGames);
}

function filterGames() {
  const q = ($('#game-search')?.value || '').toLowerCase();
  const result = $('#game-filter')?.value || 'all';
  const visible = state.games.filter(g => (`${opponentFor(g)} ${g.opening} ${g.timeClass}`).toLowerCase().includes(q) && (result === 'all' || g.outcome === result));
  $('#games-list').innerHTML = renderRecentGames(visible.length);
  const rows = $$('#games-list tbody tr');
  rows.forEach((row, index) => { row.dataset.id = visible[index]?.id || ''; });
  $$('#games-list [data-action="select-game"]').forEach((button, i) => button.dataset.id = visible[i]?.id || '');
}

function renderAnalysis() {
  const game = getSelectedGame();
  if (!game) {
    $('#view-root').innerHTML = `${pageHeading('Game analysis', 'Engine-backed explanations, one decision at a time.')}
      <article class="panel empty-page"><span>⌁</span><h2>Choose a game to review</h2><p>Import your Chess.com history or a PGN, then run a Stockfish analysis.</p><button class="btn btn-primary" data-action="open-import">Import games</button></article>`;
    wireViewButtons(); return;
  }
  const analysis = state.gameAnalysis[game.id];
  const moves = game.moves || [];
  const index = Math.max(0, Math.min(state.activeMoveIndex, moves.length - 1));
  const selected = moves[index] || null;
  const replay = new Chess();
  for (let i = 0; i <= index && i < moves.length; i++) replay.move(moves[i].san);
  const board = replay.board();
  const last = selected ? { from: selected.from, to: selected.to } : null;
  const evaluated = analysis?.moves?.[index];
  const isAnalysed = Boolean(analysis);
  const severity = evaluated?.severity || 'Not reviewed';
  $('#view-root').innerHTML = `${pageHeading('Game analysis', 'Understand the turning points, not just the final score.', `<button class="btn btn-outline" data-action="analyse-game" data-id="${escapeHtml(game.id)}" ${state.analysisBusy ? 'disabled' : ''}>${analysis ? 'Re-analyse game' : '✧ Analyse with Stockfish'}</button>`)}
    ${state.analysisBusy ? '<div class="analysis-queue-strip" id="analysis-progress"><span>Starting Stockfish analysis…</span><div class="progress-track"><i style="width:4%"></i></div></div>' : ''}
    <div class="analysis-toolbar"><button class="back-link" data-view="games">← All games</button><span>${fmtDate(game.date)} · ${escapeHtml(game.timeClass)}</span><span class="result-pill ${resultClass(game.outcome)}">${resultLabel(game.outcome)}</span><span class="analysis-opponent">${escapeHtml(game.whiteName)} vs ${escapeHtml(game.blackName)}</span></div>
    <div class="analysis-layout">
      <article class="panel board-panel"><div class="board-meta"><div><b>${escapeHtml(game.opening)}</b><small>${escapeHtml(game.eco || 'Opening not classified')} · ${game.moveCount} plies</small></div><span class="eval-chip ${isAnalysed ? '' : 'muted-chip'}">${isAnalysed ? `Stockfish · depth ${analysis.depth || 9}` : 'Awaiting analysis'}</span></div>
        ${renderBoard(board, last, 'analysis-board')}
        <div class="board-controls"><button data-action="first-move">|◀</button><button data-action="prev-move">‹</button><span>${selected ? `${Math.floor(index/2)+1}${index%2===0 ? '.' : '…'} ${selected.san}` : 'Starting position'}</span><button data-action="next-move">›</button><button data-action="last-move">▶|</button></div>
        <div class="move-progress"><div style="width:${moves.length ? ((index+1)/moves.length)*100 : 0}%"></div></div>
      </article>
      <div class="analysis-side">
        <article class="panel coach-panel"><div class="panel-head"><div><span class="eyebrow">MOVE COACH</span><h2>${selected ? `Move ${Math.floor(index/2)+1}${index%2===0 ? '.' : '…'}` : 'Starting position'}</h2></div><span class="severity-tag ${severity.toLowerCase().replace(' ','-')}">${severity}</span></div>
          ${evaluated?.explanation ? `<p class="coach-copy">${escapeHtml(evaluated.explanation)}</p>` : `<p class="coach-copy">${isAnalysed ? 'Choose a move to see its engine-backed explanation.' : 'Run an analysis to see what changed in this position, what your opponent threatened, and how you could improve.'}</p>`}
          ${evaluated?.bestMove ? `<div class="best-line"><span>BETTER CONTINUATION</span><b>${escapeHtml(evaluated.bestMove)}</b><small>${escapeHtml(evaluated.pv || '')}</small></div>` : ''}
          <button class="text-link" data-action="analyse-position" data-index="${index}">Analyse this position ↗</button>
        </article>
        <article class="panel move-list-panel"><div class="panel-head"><div><span class="eyebrow">MOVE BY MOVE</span><h2>Game score</h2></div><span class="count-label">${moves.length} PLIES</span></div>
          <div class="move-list">${renderMoveList(moves, analysis, index)}</div>
        </article>
        <article class="panel insight-mini"><span class="mini-bulb">✦</span><div><b>${analysis ? `${analysis.mistakes?.length || 0} review positions found` : 'Find your turning points'}</b><small>${analysis ? 'Your critical moments are saved in the Mistake Bank.' : 'Stockfish checks each position and saves significant mistakes for later practice.'}</small></div></article>
      </div>
    </div>`;
  wireViewButtons();
}

function renderBoard(board, lastMove = null, className = '') {
  let html = `<div class="chessboard ${className}">`;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      const square = `${'abcdefgh'[c]}${8-r}`;
      const light = (r+c)%2 === 0;
      const highlighted = lastMove && (lastMove.from === square || lastMove.to === square);
      const glyph = piece ? PIECES[`${piece.color}${piece.type}`] : '';
      html += `<div class="square ${light ? 'light' : 'dark'} ${highlighted ? 'last-move' : ''}" data-square="${square}"><span class="piece ${piece?.color === 'w' ? 'white-piece' : 'black-piece'}">${glyph}</span>${c === 0 ? `<small class="coord rank">${8-r}</small>` : ''}${r === 7 ? `<small class="coord file">${'abcdefgh'[c]}</small>` : ''}</div>`;
    }
  }
  return html + '</div>';
}

function renderMoveList(moves, analysis, activeIndex) {
  if (!moves.length) return '<div class="empty-state small">No moves recorded.</div>';
  let rows = '';
  for (let i = 0; i < moves.length; i += 2) {
    const whiteIndex = i;
    const blackIndex = i + 1;
    const white = moves[whiteIndex];
    const black = moves[blackIndex];
    const wSeverity = analysis?.moves?.[whiteIndex]?.severity;
    const bSeverity = analysis?.moves?.[blackIndex]?.severity;
    rows += `<div class="move-row"><span class="move-number">${Math.floor(i/2)+1}.</span><button class="move-btn ${activeIndex === whiteIndex ? 'active' : ''}" data-action="jump-move" data-index="${whiteIndex}">${escapeHtml(white.san)}${wSeverity ? `<i class="move-mark ${wSeverity === 'Blunder' ? 'blunder' : wSeverity === 'Mistake' ? 'mistake' : 'inaccuracy'}"></i>` : ''}</button><button class="move-btn ${activeIndex === blackIndex ? 'active' : ''}" data-action="jump-move" data-index="${blackIndex}" ${!black ? 'disabled' : ''}>${black ? escapeHtml(black.san) : ''}${bSeverity ? `<i class="move-mark ${bSeverity === 'Blunder' ? 'blunder' : bSeverity === 'Mistake' ? 'mistake' : 'inaccuracy'}"></i>` : ''}</button></div>`;
  }
  return rows;
}

function renderBlunders() {
  const mistakes = allMistakes();
  $('#view-root').innerHTML = `${demoPanel()}${pageHeading('Mistake bank', 'Your personal collection of positions that are worth remembering.', `<button class="btn btn-outline" data-view="training">Review due positions ↗</button>`)}
    <div class="blunder-summary"><div><span class="eyebrow">SAVED POSITIONS</span><strong>${state.demo ? '18' : mistakes.length}</strong><small>Positions to revisit</small></div><div><span class="eyebrow">DUE TO REVIEW</span><strong>${state.demo ? '6' : mistakes.filter(m => !m.due || new Date(m.due) <= new Date()).length}</strong><small>Ready for another attempt</small></div><div><span class="eyebrow">MOST COMMON THEME</span><strong>${mistakes[0]?.theme || (state.demo ? 'Loose pieces' : '—')}</strong><small>Your biggest recurring pattern</small></div></div>
    <div class="filter-row"><span class="eyebrow">FILTER BY THEME</span><div class="filter-chips"><button class="filter-chip active" data-theme="all">All positions</button><button class="filter-chip" data-theme="Hanging piece">Hanging pieces</button><button class="filter-chip" data-theme="Missed tactic">Missed tactics</button><button class="filter-chip" data-theme="Opening choice">Opening</button><button class="filter-chip" data-theme="King safety">King safety</button></div></div>
    <div class="mistake-grid" id="mistake-grid">${renderMistakeCards(mistakes)}</div>`;
  wireViewButtons();
  $$('.filter-chip').forEach(button => button.addEventListener('click', () => {
    $$('.filter-chip').forEach(b => b.classList.remove('active'));
    button.classList.add('active');
    const theme = button.dataset.theme;
    const next = theme === 'all' ? mistakes : mistakes.filter(m => m.theme === theme);
    $('#mistake-grid').innerHTML = renderMistakeCards(next);
    wireViewButtons();
  }));
}

function renderMistakeCards(mistakes) {
  if (!mistakes.length && !state.demo) return `<div class="panel empty-page"><span>♜</span><h2>Your mistake bank is empty</h2><p>Analyse a game and significant mistakes will be saved here automatically.</p><button class="btn btn-primary" data-view="games">Choose a game</button></div>`;
  const demos = state.demo ? [
    { id:'demo-1', severity:'Blunder', theme:'Hanging piece', san:'Bxf7+', explanation:'The bishop was left undefended after the king recaptured. Check the opponent’s forcing replies before taking material.', due:'', loss:380, fen:'r1bqk2r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 4' },
    { id:'demo-2', severity:'Mistake', theme:'Missed tactic', san:'Qd2?', explanation:'A simple knight fork was available. Look for checks and captures before committing your queen.', due:'', loss:210, fen:'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7' },
    { id:'demo-3', severity:'Inaccuracy', theme:'Opening choice', san:'h3?!', explanation:'This move spends a tempo without solving a central-development problem.', due:'', loss:95, fen:'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 1 2' }
  ] : [];
  const list = mistakes.length ? mistakes : demos;
  return list.map(m => `<article class="panel mistake-card"><div class="mistake-card-top"><span class="severity-tag ${String(m.severity || 'Mistake').toLowerCase()}">${escapeHtml(m.severity || 'Mistake')}</span><span class="loss-value">−${Math.round((m.loss || 0)/100*10)/10}</span></div><div class="mistake-mini-board">${miniBoardFromFen(m.fen)}</div><div class="mistake-info"><span class="eyebrow">${escapeHtml(m.theme || 'Tactical oversight')}</span><h3>${escapeHtml(m.move || m.san || 'Review position')}</h3><p>${escapeHtml(m.explanation || 'Review this position and find the stronger continuation.')}</p><div class="mistake-card-foot"><span>${m.due && new Date(m.due) > new Date() ? `Due ${fmtDate(m.due)}` : 'Ready to review'}</span><button data-action="review-mistake" data-id="${escapeHtml(m.id)}">Review →</button></div></div></article>`).join('');
}

function miniBoardFromFen(fen) {
  try {
    const chess = new Chess(fen);
    return chess.board().map((row, r) => row.map((piece, c) => `<span class="mini-square ${(r+c)%2===0?'light':'dark'}">${piece ? `<i class="${piece.color==='w'?'white-piece':'black-piece'}">${PIECES[piece.color+piece.type]}</i>` : ''}</span>`).join('')).join('');
  } catch { return ''; }
}

function renderOpenings() {
  const openings = aggregateOpenings();
  const list = state.demo ? [
    { name:'Queen’s Gambit Declined', games:17, wins:10, losses:5, draws:2, white:13, black:4 },
    { name:'Sicilian Defence', games:11, wins:4, losses:6, draws:1, white:2, black:9 },
    { name:'Italian Game', games:8, wins:5, losses:2, draws:1, white:8, black:0 },
    { name:'Caro-Kann Defence', games:6, wins:2, losses:3, draws:1, white:1, black:5 }
  ] : openings;
  $('#view-root').innerHTML = `${demoPanel()}${pageHeading('Opening repertoire', 'Learn which positions lead to good games — and which ones need work.')}
    <div class="opening-highlight-grid"><article class="panel opening-highlight"><span class="eyebrow">YOUR BEST OPENING</span><h2>${list.length ? escapeHtml([...list].sort((a,b)=>pct(b.wins,b.games)-pct(a.wins,a.games))[0].name) : 'Not enough games yet'}</h2><div class="opening-highlight-foot"><strong>${list.length ? `${pct([...list].sort((a,b)=>pct(b.wins,b.games)-pct(a.wins,a.games))[0].wins,[...list].sort((a,b)=>pct(b.wins,b.games)-pct(a.wins,a.games))[0].games)}%` : '—'}</strong><span>win rate in your sample</span></div></article><article class="panel opening-highlight warning"><span class="eyebrow">NEEDS ATTENTION</span><h2>${list.length ? escapeHtml([...list].sort((a,b)=>pct(a.wins,a.games)-pct(b.wins,b.games))[0].name) : 'Import your games'}</h2><div class="opening-highlight-foot"><strong>${list.length ? `${pct([...list].sort((a,b)=>pct(a.wins,a.games)-pct(b.wins,b.games))[0].wins,[...list].sort((a,b)=>pct(a.wins,a.games)-pct(b.wins,b.games))[0].games)}%` : '—'}</strong><span>win rate in your sample</span></div></article></div>
    <article class="panel opening-table-panel"><div class="panel-head"><div><span class="eyebrow">OPENING PERFORMANCE</span><h2>Your results by variation</h2><p>These are your own results, not a general opening ranking.</p></div><span class="count-label">${list.reduce((n,o)=>n+o.games,0)} GAMES</span></div>
      <div class="table-wrap"><table class="data-table opening-table"><thead><tr><th>OPENING</th><th>GAMES</th><th>WIN / DRAW / LOSS</th><th>WIN RATE</th><th>AS WHITE / BLACK</th></tr></thead><tbody>${list.length ? list.map(o => `<tr><td><b>${escapeHtml(o.name)}</b></td><td>${o.games}</td><td><div class="result-stack"><i style="width:${pct(o.wins,o.games)}%"></i><i style="width:${pct(o.draws,o.games)}%"></i><i style="width:${pct(o.losses,o.games)}%"></i></div><small>${o.wins}W · ${o.draws}D · ${o.losses}L</small></td><td><strong>${pct(o.wins,o.games)}%</strong></td><td class="muted">${o.white} / ${o.black}</td></tr>`).join('') : '<tr><td colspan="5">Import games to build your opening report.</td></tr>'}</tbody></table></div></article>
    <div class="info-strip"><span>ⓘ</span><p>Opening labels are taken from the game PGN when available. The app groups unlabelled games by their early move sequence; those groups may be broader than a named ECO variation.</p></div>`;
  wireViewButtons();
}

function renderTraining() {
  if (state.trainingMode === 'sparring') { renderSparring(); return; }
  if (state.trainingMode === 'openings') { renderOpeningDrill(); return; }
  const due = allMistakes().filter(m => !m.due || new Date(m.due) <= new Date());
  const active = due[state.trainingIndex % Math.max(1, due.length)] || null;
  const fen = active?.fen || 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3';
  let chess = new Chess(fen);
  $('#view-root').innerHTML = `${pageHeading('Training room', 'Short, focused sessions built around the positions you actually need to learn.', `<button class="btn btn-outline" data-view="blunders">Open mistake bank ↗</button>`)}
    <div class="training-tabs"><button class="${state.trainingMode === 'review' ? 'active' : ''}" data-action="training-tab" data-mode="review">Personal review</button><button class="${state.trainingMode === 'openings' ? 'active' : ''}" data-action="training-tab" data-mode="openings">Opening recall</button><button class="${state.trainingMode === 'sparring' ? 'active' : ''}" data-action="training-tab" data-mode="sparring">AI sparring coach <span>NEW</span></button></div>
    <div class="training-grid"><div class="training-main"><div class="training-session-head"><div><span class="eyebrow">PERSONAL REVIEW · ${due.length || (state.demo ? 3 : 0)} DUE</span><h2>${active ? `Review: ${escapeHtml(active.theme || 'Tactical pattern')}` : 'Your first training session'}</h2><p>${active ? 'Find the strongest move in this position. Take your time.' : 'Import and analyse a game to generate personalised exercises.'}</p></div><span class="session-count">${Math.min(state.trainingIndex+1, Math.max(1,due.length))} <i>/</i> ${due.length || 3}</span></div>
      <div class="training-board-wrap">${renderBoard(chess.board(), null, 'training-board')}</div>
      <div class="training-prompt"><span class="coach-avatar">✦</span><div><b>${active ? 'Your coach asks:' : 'Your coach is ready:'}</b><p>${active ? 'What is the opponent threatening? Look for forcing moves before choosing.' : 'Connect your games to turn your own mistakes into exercises.'}</p></div></div>
      <div class="training-answer-row"><input id="training-move" placeholder="Type a move, e.g. Nf3" autocomplete="off"/><button class="btn btn-primary" data-action="submit-training" ${active ? '' : 'disabled'}>Submit move</button><button class="btn btn-ghost" data-action="reveal-training" ${active ? '' : 'disabled'}>Hint</button></div>
      <div class="training-feedback" id="training-feedback">${escapeHtml(state.trainingMessage || 'The solution stays hidden until you ask for a hint.')}</div>
      </div>
      <aside class="training-aside"><article class="panel study-queue"><span class="eyebrow">YOUR REVIEW QUEUE</span><h3>Make it stick.</h3><p>Positions return just before you are likely to forget them.</p><div class="queue-stat"><strong>${due.length || (state.demo ? '3' : '0')}</strong><span>positions due now</span></div><div class="srs-legend"><span><i class="orange-bg"></i> Again · 10 min</span><span><i class="sand-bg"></i> Hard · 1 day</span><span><i class="green-bg"></i> Good · 3 days</span><span><i class="blue-bg"></i> Easy · 7 days</span></div></article>
      <article class="panel blind-card"><div class="blind-icon">◉</div><div><b>Blind calculation</b><p>Visualise the next 2–3 half-moves before revealing the board.</p><label class="toggle"><input type="checkbox" id="blind-toggle"><span></span></label></div></article>
      <article class="panel training-stat"><span class="eyebrow">STREAK</span><strong>4 <small>days</small></strong><p>Consistency beats cramming.</p></article></aside>
    </div>`;
  wireViewButtons();
  $('#training-move')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitTrainingMove(active); });
  $('#blind-toggle')?.addEventListener('change', e => {
    const board = $('.training-board-wrap');
    if (board) board.classList.toggle('blind-active', e.target.checked);
    const feedback = $('#training-feedback');
    if (feedback) feedback.textContent = e.target.checked ? 'Blind mode is on. Rebuild the position in your head, then enter your move.' : 'The board is visible again. Check your visualised position.';
  });
}

function getOpeningDrillGame(excludeId = null) {
  const eligible = state.games.filter(g => g.moves?.length >= 8 && g.moves.some(m => m.color === g.userColor));
  if (!eligible.length) return null;
  return eligible.find(g => g.id !== excludeId) || eligible[0];
}

function prepareOpeningDrill(game = null) {
  const target = game || getOpeningDrillGame(state.openingDrill?.gameId || null);
  if (!target) { state.openingDrill = null; return null; }
  const firstIndex = target.moves.findIndex(m => m.color === target.userColor);
  const chess = new Chess();
  for (let i = 0; i < firstIndex; i++) chess.move(target.moves[i].san);
  state.openingDrill = { gameId: target.id, index: firstIndex, chess, complete: false, startedAt: Date.now(), message: 'Find the move you played in this opening. Try to recall the plan, not just the notation.' };
  return state.openingDrill;
}

function renderOpeningDrill() {
  const drill = state.openingDrill || prepareOpeningDrill();
  if (!drill) {
    $('#view-root').innerHTML = `${pageHeading('Opening recall', 'Rebuild the openings you actually play, one move at a time.')}
      <div class="training-tabs"><button data-action="training-tab" data-mode="review">Personal review</button><button class="active" data-action="training-tab" data-mode="openings">Opening recall</button><button data-action="training-tab" data-mode="sparring">AI sparring coach</button></div>
      <article class="panel empty-page"><span>⌘</span><h2>Import games to build your repertoire</h2><p>Tempo will turn your own opening choices into recall drills.</p><button class="btn btn-primary" data-action="open-import">Import games</button></article>`;
    wireViewButtons(); return;
  }
  const game = state.games.find(g => g.id === drill.gameId);
  const progress = game ? Math.floor(drill.index / game.moves.length * 100) : 0;
  const due = Object.values(state.openingSchedules || {}).filter(s => !s.due || new Date(s.due) <= new Date()).length;
  $('#view-root').innerHTML = `${pageHeading('Opening recall', 'Memorise the lines you reach most often. Repetition turns a good start into a reliable habit.')}
    <div class="training-tabs"><button data-action="training-tab" data-mode="review">Personal review</button><button class="active" data-action="training-tab" data-mode="openings">Opening recall</button><button data-action="training-tab" data-mode="sparring">AI sparring coach <span>NEW</span></button></div>
    <div class="opening-drill-layout"><article class="panel opening-drill-main"><div class="training-session-head"><div><span class="eyebrow">YOUR REPERTOIRE · ${escapeHtml(game?.eco || 'PERSONAL LINE')}</span><h2>${escapeHtml(game?.opening || 'Opening line')}</h2><p>Recall your move from a game you have already played.</p></div><span class="session-count">${Math.min(drill.index+1, game?.moves.length || 1)} <i>/</i> ${game?.moves.length || 1}</span></div>
        <div class="opening-board-wrap">${renderBoard(drill.chess.board(), null, 'opening-drill-board')}</div>
        <div class="opening-drill-prompt"><span class="coach-avatar">⌘</span><div><b>What did you play here?</b><p>${escapeHtml(drill.message)}</p></div></div>
        <div class="training-answer-row"><input id="opening-move" placeholder="Enter your move, e.g. Nf3" autocomplete="off"/><button class="btn btn-primary" data-action="submit-opening">Check move</button><button class="btn btn-ghost" data-action="hint-opening">Hint</button></div>
        <div id="opening-feedback" class="training-feedback"></div>
        <div class="move-progress"><div style="width:${progress}%"></div></div>
      </article><aside class="opening-drill-side"><article class="panel"><span class="eyebrow">SPACED REPETITION</span><h3>Remember it for longer.</h3><p>Easy recalls return in a week. If a move slips, you see it again much sooner.</p><div class="queue-stat"><strong>${due}</strong><span>opening lines due</span></div><div class="srs-legend"><span><i class="orange-bg"></i> Again · 10 min</span><span><i class="sand-bg"></i> Hard · 1 day</span><span><i class="green-bg"></i> Good · 3 days</span><span><i class="blue-bg"></i> Easy · 7 days</span></div></article>
        <article class="panel"><span class="eyebrow">LINE SOURCE</span><b class="line-source-name">${escapeHtml(opponentFor(game) || '')}</b><p class="line-source-note">A real line from your imported ${escapeHtml(game?.timeClass || 'chess')} game on ${fmtDate(game?.date)}.</p><button class="btn btn-outline full" data-action="next-opening">Choose another line ↗</button></article></aside></div>`;
  wireViewButtons();
  $('#opening-move')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitOpeningMove(); });
}

function submitOpeningMove() {
  const drill = state.openingDrill;
  const game = state.games.find(g => g.id === drill?.gameId);
  if (!drill || !game || drill.complete) return;
  const input = $('#opening-move');
  const text = (input?.value || '').trim();
  if (!text) return;
  const expected = game.moves[drill.index];
  try {
    const played = drill.chess.move(text);
    if (played.san !== expected.san) {
      drill.chess.undo();
      state.openingSchedules[game.opening] = { due: new Date(Date.now() + 10*60*1000).toISOString(), interval: 10 };
      save();
      $('#opening-feedback').textContent = `Not the move from your line. You played ${played.san}; your recorded move was ${expected.san}. Review the plan, then try again.`;
      $('#opening-feedback').classList.remove('success');
      return;
    }
    const responseMs = Date.now() - (drill.startedAt || Date.now());
    let next = drill.index + 1;
    while (next < game.moves.length && game.moves[next].color !== game.userColor) {
      drill.chess.move(game.moves[next].san);
      next++;
    }
    drill.index = next;
    if (next >= game.moves.length) {
      drill.complete = true;
      drill.message = 'You recalled the full line. The next review is scheduled in 7 days.';
      const quickRecall = responseMs < 12000;
      const intervalMs = quickRecall ? 7*86400000 : 10*60*1000;
      state.openingSchedules[game.opening] = { due: new Date(Date.now() + intervalMs).toISOString(), interval: quickRecall ? 7 : 10/1440, repetitions: (state.openingSchedules[game.opening]?.repetitions || 0) + 1 };
      $('#opening-feedback').textContent = quickRecall ? 'Line complete. Quick, accurate recall — scheduled again in 7 days.' : 'Line complete, but recall took a little longer. This line will return in 10 minutes.';
    } else {
      drill.message = 'Correct. Your opponent’s recorded reply has been played. Find your next move.';
      drill.startedAt = Date.now();
      $('#opening-feedback').textContent = 'Correct. The opponent’s reply is on the board.';
    }
    $('#opening-feedback').classList.add('success');
    save();
    renderOpeningDrill();
    if (drill.complete) toast('Opening line completed. Review scheduled in 7 days.');
  } catch {
    $('#opening-feedback').textContent = 'That move is not legal in this position. Check the board and try standard notation such as Nf3.';
  }
}

function hintOpeningMove() {
  const drill = state.openingDrill;
  const game = state.games.find(g => g.id === drill?.gameId);
  if (!drill || !game || drill.complete) return;
  const expected = game.moves[drill.index]?.san;
  $('#opening-feedback').textContent = `Hint: your recorded move was ${expected}. Replay the reason for the move before continuing.`;
}

function renderSparring() {
  const p = state.practice;
  const chess = p.chess;
  const board = chess.board();
  const selected = p.selected;
  const targets = selected ? chess.moves({ square: selected, verbose: true }).map(m => m.to) : [];
  const baseBoard = renderBoard(board, p.lastMove, 'sparring-board');
  const status = p.busy ? 'The coach is thinking…' : chess.isGameOver() ? (chess.isCheckmate() ? 'Checkmate' : 'Game over') : chess.turn() === 'w' ? 'Your move · White' : 'Coach to move · Black';
  $('#view-root').innerHTML = `${pageHeading('Training room', 'Practise your decisions against an opponent that can meet you at your level.', `<button class="btn btn-outline" data-view="games">Review a game ↗</button>`)}
    <div class="training-tabs"><button data-action="training-tab" data-mode="review">Personal review</button><button data-action="training-tab" data-mode="openings">Opening recall</button><button class="active" data-action="training-tab" data-mode="sparring">AI sparring coach <span>NEW</span></button></div>
    <div class="sparring-layout"><article class="panel sparring-board-panel"><div class="sparring-board-head"><div><span class="eyebrow">SOCRATIC SPARRING</span><h2>Play. Pause. Understand.</h2><p>${status}</p></div><span class="skill-pill">LEVEL ${p.skill}</span></div>
      <div class="sparring-board-wrap">${baseBoard}</div>
      <div class="sparring-controls"><button class="btn btn-ghost" data-action="reset-practice">↻ New game</button><span>White: You <i>·</i> Black: Tempo coach</span><button class="btn btn-outline" data-action="flip-practice">⇅ Flip board</button></div>
    </article>
    <aside class="sparring-side"><article class="panel coach-console"><div class="coach-title"><span class="coach-avatar">✦</span><div><b>Your AI coach</b><small>Stockfish · rating-adjusted sparring</small></div><span class="engine-dot ${state.engineReady ? 'online' : ''}"></span></div>
        <div class="coach-message ${p.paused ? 'warning-message' : ''}"><span class="eyebrow">COACH PROMPT</span><p id="sparring-message">${escapeHtml(p.message)}</p></div>
        ${p.paused ? `<div class="hint-actions"><button class="btn btn-primary full" data-action="reveal-practice">Show the stronger move</button><small>Or make another move to try again without seeing the answer.</small></div>` : ''}
        ${p.hint ? `<div class="best-line"><span>ENGINE IDEA</span><b>${escapeHtml(p.hint)}</b></div>` : ''}
        <div class="coach-settings"><div class="setting-head"><label for="skill-level">OPPONENT STRENGTH</label><strong id="skill-value">${p.skill} / 20</strong></div><input id="skill-level" type="range" min="1" max="20" value="${p.skill}"/><div class="range-captions"><span>Beginner</span><span>Expert</span></div>
          <label class="coach-toggle-row"><span><b>Second-chance coach</b><small>Pause after a serious mistake and let me retry.</small></span><input id="coach-switch" type="checkbox" ${p.coach ? 'checked' : ''}/></label>
        </div></article>
      <article class="panel coach-tip"><span class="eyebrow">A BETTER HABIT</span><b>Before every move, ask:</b><p>What changed in the position? What is my opponent threatening? What are my checks, captures and threats?</p></article>
    </aside></div>`;
  wireViewButtons();
  $$('.sparring-board [data-square]').forEach(square => {
    const sq = square.dataset.square;
    if (targets.includes(sq)) square.classList.add('legal-target');
    if (selected === sq) square.classList.add('selected-square');
    square.addEventListener('click', () => practiceSquareClick(sq));
  });
  $('#skill-level')?.addEventListener('input', e => {
    p.skill = Number(e.target.value);
    $('#skill-value').textContent = `${p.skill} / 20`;
    $('.skill-pill').textContent = `LEVEL ${p.skill}`;
  });
  $('#coach-switch')?.addEventListener('change', e => { p.coach = e.target.checked; });
}

async function practiceSquareClick(square) {
  const p = state.practice;
  const chess = p.chess;
  if (p.busy || chess.isGameOver() || chess.turn() !== 'w') return;
  const clicked = chess.get(square);
  if (!p.selected) {
    if (clicked && clicked.color === 'w') { p.selected = square; renderSparring(); }
    return;
  }
  if (clicked && clicked.color === 'w') { p.selected = square; renderSparring(); return; }
  const from = p.selected;
  const beforeFen = chess.fen();
  p.busy = true;
  p.selected = null;
  p.message = 'Let’s look at the position before we decide what happens next…';
  renderSparring();
  try {
    await engine.init();
    state.engineReady = true;
    const before = await engine.evaluate(beforeFen, 8, p.skill);
    const move = chess.move({ from, to: square, promotion: 'q' });
    if (!move) {
      p.busy = false;
      p.message = 'That move is not legal. Select one of the highlighted destination squares.';
      renderSparring();
      return;
    }
    const after = await engine.evaluate(chess.fen(), 8, p.skill);
    const loss = Math.max(0, scoreToCp(before) + scoreToCp(after));
    if (p.coach && loss >= 210) {
      chess.undo();
      p.paused = true;
      p.pendingHint = uciToSan(beforeFen, before.bestMove);
      p.message = loss >= 350 ? 'Hold on. This move may allow a decisive tactic. Look at the opponent’s forcing replies before committing.' : 'Pause for a second. Your move gives the opponent a useful idea. Can you find a safer continuation?';
      p.busy = false;
      renderSparring();
      return;
    }
    p.lastMove = { from, to: square };
    p.paused = false;
    p.hint = '';
    p.message = loss >= 110 ? 'That move gives away some advantage. Let’s see how the position develops.' : 'Good. You have kept the position under control. Now watch how the opponent responds.';
    p.busy = false;
    renderSparring();
    await makeCoachMove();
  } catch (error) {
    p.busy = false;
    p.message = error.message || 'The engine could not respond. Check the Stockfish files and try again.';
    renderSparring();
  }
}

function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return '';
  try {
    const c = new Chess(fen);
    return c.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || 'q' })?.san || '';
  } catch { return ''; }
}

function uciPvToSan(fen, pv) {
  if (!pv) return '';
  try {
    const c = new Chess(fen);
    const san = [];
    for (const token of pv.trim().split(/\s+/).slice(0, 8)) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)) break;
      const move = c.move({ from: token.slice(0,2), to: token.slice(2,4), promotion: token[4] || 'q' });
      if (!move) break;
      san.push(move.san);
    }
    return san.join(' ');
  } catch { return ''; }
}

async function makeCoachMove() {
  const p = state.practice;
  if (p.busy || p.chess.isGameOver()) return;
  p.busy = true;
  p.message = 'The coach is considering the position…';
  renderSparring();
  try {
    const result = await engine.evaluate(p.chess.fen(), 9, p.skill);
    const uci = result.bestMove;
    const move = p.chess.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || 'q' });
    p.lastMove = move ? { from: move.from, to: move.to } : p.lastMove;
    p.message = move ? `The coach played ${move.san}. What changed? Find the next plan rather than making a move automatically.` : 'The position is finished.';
    p.busy = false;
    renderSparring();
  } catch (error) {
    p.busy = false;
    p.message = error.message || 'The coach could not find a move.';
    renderSparring();
  }
}

function revealPracticeHint() {
  const p = state.practice;
  if (!p.pendingHint) return;
  p.hint = `Try ${p.pendingHint}`;
  p.message = 'The engine’s strongest continuation is shown. Play it yourself to see the opponent’s reply.';
  p.paused = false;
  renderSparring();
}

function resetPractice() {
  state.practice.chess = new Chess();
  state.practice.selected = null;
  state.practice.lastMove = null;
  state.practice.busy = false;
  state.practice.paused = false;
  state.practice.message = 'Choose a white piece, then choose its destination square.';
  state.practice.hint = '';
  state.practice.pendingHint = '';
  renderSparring();
}

function submitTrainingMove(active) {
  if (!active) return;
  const input = $('#training-move');
  const moveText = (input?.value || '').trim();
  if (!moveText) return;
  try {
    const c = new Chess(active.fen);
    const move = c.move(moveText);
    if (!move) throw new Error('Illegal move');
    const best = active.bestMoveSan || active.bestMove;
    const correct = best && move.san === best;
    state.trainingMessage = correct ? 'That’s the move. Strong calculation. Choose how well you knew it to schedule the next review.' : `Not quite. ${best ? `The engine’s top move is ${best}.` : 'Look for a forcing move.'} Review the threat and try again.`;
    $('#training-feedback').textContent = state.trainingMessage;
    if (correct) {
      $('#training-feedback').classList.add('success');
      const position = state.blunders.find(m => m.id === active.id);
      if (position) position.due = new Date(Date.now() + 7*86400000).toISOString();
      toast('Position solved. Scheduled for another review.');
      save();
    }
  } catch {
    state.trainingMessage = 'That move does not fit this position. Try standard notation such as Nf3 or e4.';
    $('#training-feedback').textContent = state.trainingMessage;
  }
}

function renderInsights() {
  const mistakes = allMistakes();
  const stats = currentStats();
  const phase = state.demo ? [
    { name: 'Opening', value: 83, loss: '−0.21' },
    { name: 'Middlegame', value: 69, loss: '−0.48' },
    { name: 'Endgame', value: 76, loss: '−0.32' }
  ] : phaseMetrics();
  $('#view-root').innerHTML = `${demoPanel()}${pageHeading('Player insights', 'Your diagnostic profile — built from the decisions inside your games.')}
    <div class="insight-grid"><article class="panel weakness-panel"><div class="panel-head"><div><span class="eyebrow">WEAKNESS RADAR</span><h2>Where to focus</h2><p>Estimated move quality by phase.</p></div><span class="select-chip">All games ⌄</span></div><div class="radar-graphic"><svg viewBox="0 0 360 280" role="img" aria-label="Weakness radar chart"><g transform="translate(180 137)">${[1,.75,.5,.25].map(k=>`<polygon points="${Array.from({length:6},(_,i)=>`${Math.cos((i*60-90)*Math.PI/180)*135*k},${Math.sin((i*60-90)*Math.PI/180)*110*k}`).join(' ')}" class="radar-grid"/>`).join('')}<polygon points="${[83,66,73,58,80,62].map((v,i)=>`${Math.cos((i*60-90)*Math.PI/180)*135*v/100},${Math.sin((i*60-90)*Math.PI/180)*110*v/100}`).join(' ')}" class="radar-shape"/><g class="radar-labels"><text x="0" y="-126">Opening</text><text x="122" y="-60">Tactics</text><text x="122" y="70">Endgame</text><text x="0" y="132">Time</text><text x="-134" y="70">King safety</text><text x="-134" y="-60">Middlegame</text></g></g></svg></div><div class="radar-note"><span class="orange-dot"></span> Lower scores indicate a skill area to prioritise.</div></article>
    <article class="panel phase-panel"><div class="panel-head"><div><span class="eyebrow">PHASE ACCURACY</span><h2>Where your moves hold up</h2><p>Average centipawn loss by game phase.</p></div></div>${phase.map(p=>`<div class="phase-row"><div class="phase-label"><b>${p.name}</b><span>${p.loss} avg loss</span></div><div class="phase-track"><i style="width:${p.value}%"></i></div><strong>${p.value}%</strong></div>`).join('')}<div class="info-strip compact"><span>ⓘ</span><p>Phase values become meaningful after Stockfish has reviewed your games. Demo figures are illustrative, and your analysis depth affects estimates.</p></div></article></div>
    <div class="lower-grid insight-lower"><article class="panel"><div class="panel-head"><div><span class="eyebrow">MISTAKE PATTERNS</span><h2>What keeps happening</h2></div></div>${renderPatternBars(mistakes)}</article><article class="panel"><div class="panel-head"><div><span class="eyebrow">YOUR PROFILE</span><h2>Training signals</h2></div></div><div class="signal-row"><span class="signal-icon green">↗</span><div><b>${stats.games || (state.demo ? 42 : 0)} games in history</b><small>More games make your trends more reliable.</small></div></div><div class="signal-row"><span class="signal-icon orange">⌁</span><div><b>${mistakes.length || (state.demo ? 18 : 0)} positions to review</b><small>Turn critical moments into repeatable practice.</small></div></div><div class="signal-row"><span class="signal-icon blue">◷</span><div><b>Clock telemetry</b><small>Time trouble needs clock timestamps in imported PGNs; not all archives expose them.</small></div></div></article></div>`;
  wireViewButtons();
}

function phaseMetrics() {
  const moves = Object.values(state.gameAnalysis).flatMap(a => a.moves || []).filter(m => m.isUserMove);
  const groups = { Opening: [], Middlegame: [], Endgame: [] };
  for (const m of moves) groups[m.phase || 'Middlegame'].push(m.loss || 0);
  return Object.entries(groups).map(([name, vals]) => {
    const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    return { name, value: Math.max(0, Math.min(100, Math.round(100 - avg / 10))), loss: vals.length ? `−${(avg/100).toFixed(2)}` : '—' };
  });
}

function renderPatternBars(mistakes) {
  const themes = ['Hanging piece', 'Missed tactic', 'Opening choice', 'King safety', 'Calculation'];
  const counts = themes.map(theme => ({ theme, value: mistakes.filter(m => m.theme === theme).length }));
  const max = Math.max(1, ...counts.map(c => c.value));
  return counts.map(c => `<div class="pattern-row"><div><b>${c.theme}</b><span>${c.value} positions</span></div><div class="pattern-track"><i style="width:${state.demo && !c.value ? ({'Hanging piece':34,'Missed tactic':27,'Opening choice':19,'King safety':12,'Calculation':8}[c.theme]) : c.value/max*100}%"></i></div></div>`).join('');
}

function renderImportModal() {
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onclick="event.stopPropagation()"><button class="modal-close" data-action="close-modal">×</button><div class="modal-mark">♘</div><span class="eyebrow">BRING YOUR GAMES IN</span><h2 id="import-title">Connect your chess history.</h2><p>Import public Chess.com games or drop in a PGN export. Your data is analysed locally in this browser.</p>
    <form id="chesscom-form"><label for="chesscom-username">CHESS.COM USERNAME</label><div class="input-with-prefix"><span>@</span><input id="chesscom-username" name="username" placeholder="yourusername" autocomplete="off" required value="${escapeHtml(state.username)}"/></div><div class="form-row"><div><label for="month-limit">HOW FAR BACK</label><select id="month-limit"><option value="3">Last 3 months</option><option value="6" selected>Last 6 months</option><option value="12">Last 12 months</option><option value="24">Last 2 years</option><option value="999">All available months</option></select></div><div><label for="game-limit">MAX GAMES</label><select id="game-limit"><option value="25">25 games</option><option value="50">50 games</option><option value="100" selected>100 games</option><option value="250">250 games</option></select></div></div><button class="btn btn-primary full" type="submit" id="connect-button">Connect & import games <span>→</span></button><div class="import-progress" id="import-progress"></div><div class="import-error" id="import-error"></div></form>
    <div class="modal-divider"><span>OR</span></div><label class="upload-pgn" for="pgn-file"><span>↑</span><div><b>Import a PGN file</b><small>Export your games from any chess platform.</small></div><em>Browse</em></label><input type="file" id="pgn-file" accept=".pgn,.txt,text/plain" hidden />
    <div class="modal-footnote">Chess.com username import uses its public, read-only API. This app is independent and not endorsed by Chess.com.</div></div></div>`;
  $('#chesscom-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#chesscom-username').value.trim();
    const months = Number($('#month-limit').value);
    const limit = Number($('#game-limit').value);
    const button = $('#connect-button');
    button.disabled = true;
    button.textContent = 'Connecting…';
    $('#import-error').textContent = '';
    $('#import-progress').textContent = 'Checking public profile…';
    state.importBusy = true;
    try {
      const result = await importChessCom(username, months, limit);
      if (!result.games.length) throw new Error('No completed games were found in the selected period.');
      state.username = username;
      state.profile = result.profile;
      state.games = result.games;
      state.gameAnalysis = {};
      state.blunders = [];
      state.openings = aggregateOpenings();
      state.demo = false;
      state.selectedGameId = state.games[0].id;
      state.view = 'overview';
      save();
      $('#modal-root').innerHTML = '';
      renderShell();
      toast(`Imported ${result.games.length} games from ${username}.`);
    } catch (error) {
      $('#import-error').textContent = error.message || 'Import failed. Try a PGN file instead.';
      button.disabled = false;
      button.textContent = 'Try again →';
    } finally {
      state.importBusy = false;
    }
  });
  $('#pgn-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = splitPgn(text).map(pgn => {
        try { return parseOnePgn(pgn, { date: file.lastModified ? new Date(file.lastModified).toISOString() : null }, state.username); }
        catch (error) { console.warn('Skipping invalid PGN:', error); return null; }
      }).filter(Boolean);
      if (!parsed.length) throw new Error('No valid chess games were found in that file.');
      state.games = [...parsed, ...state.games].filter((g, i, a) => a.findIndex(x => x.id === g.id) === i).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
      state.demo = false;
      state.selectedGameId = state.games[0].id;
      save();
      $('#modal-root').innerHTML = '';
      renderShell();
      toast(`Imported ${parsed.length} PGN games.`);
    } catch (error) { $('#import-error').textContent = error.message; }
  });
}

function renderImportProgress() {
  const node = $('#import-progress');
  if (node) node.textContent = state.importProgress;
}

async function analyseBatch() {
  if (state.batchBusy || state.analysisBusy) return;
  const queue = state.games.filter(g => !state.gameAnalysis[g.id]).slice(0, 3);
  if (!queue.length) { toast('All imported games have already been analysed.'); return; }
  state.batchBusy = true;
  state.batchDone = 0;
  state.batchTotal = queue.length;
  state.view = 'games';
  renderShell();
  for (const game of queue) {
    await analyseGame(game.id);
    state.batchDone++;
    state.view = 'games';
    renderShell();
  }
  state.batchBusy = false;
  state.view = 'games';
  renderShell();
  toast(`Batch complete: ${state.batchDone} games analysed.`);
}

async function analyseGame(gameId) {
  const game = state.games.find(g => g.id === gameId);
  if (!game || state.analysisBusy) return;
  state.analysisBusy = true;
  state.engineStatus = 'Preparing analysis';
  renderShell();
  try {
    await engine.init();
    state.engineReady = true;
    state.engineStatus = 'Stockfish ready';
    const replay = new Chess();
    const sans = game.moves.map(m => m.san);
    const positions = [];
    for (const san of sans) {
      positions.push({ fen: replay.fen(), san, color: replay.turn(), moveNumber: replay.moveNumber() });
      replay.move(san);
    }
    positions.push({ fen: replay.fen(), san: null, color: replay.turn(), moveNumber: replay.moveNumber() });
    const evaluations = [];
    const depth = 9;
    for (let i = 0; i < positions.length; i++) {
      const result = await engine.evaluate(positions[i].fen, depth);
      evaluations.push(result);
      state.engineStatus = `Analysing ${Math.min(i+1, positions.length)}/${positions.length}`;
      if (i % 6 === 0 || i === positions.length - 1) {
        const pctDone = Math.round((i+1)/positions.length*100);
        const progress = $('#analysis-progress');
        if (progress) progress.innerHTML = `<span>Stockfish is reviewing move ${Math.min(i+1, positions.length)} of ${positions.length}</span><div class="progress-track"><i style="width:${pctDone}%"></i></div>`;
        if (i % 10 === 0) await new Promise(requestAnimationFrame);
      }
    }
    const analysedMoves = [];
    const mistakes = [];
    for (let i = 0; i < game.moves.length; i++) {
      const move = game.moves[i];
      const before = evaluations[i];
      const after = evaluations[i+1];
      const loss = Math.max(0, Math.round((scoreToCp(before) + scoreToCp(after))));
      const isUserMove = move.color === game.userColor;
      let severity = 'Good';
      if (loss >= 300) severity = 'Blunder';
      else if (loss >= 150) severity = 'Mistake';
      else if (loss >= 70) severity = 'Inaccuracy';
      const moveNumber = Math.floor(i/2) + 1;
      const phase = moveNumber <= 10 ? 'Opening' : moveNumber <= 30 ? 'Middlegame' : 'Endgame';
      let theme = phase === 'Opening' ? 'Opening choice' : 'Calculation';
      const afterBoard = new Chess(positions[i+1].fen);
      const attacked = afterBoard.isAttacked(move.to, move.color === 'w' ? 'b' : 'w');
      if (attacked && loss >= 70) theme = 'Hanging piece';
      if (loss >= 150 && afterBoard.isCheck()) theme = 'King safety';
      if (loss >= 150 && theme !== 'Hanging piece' && theme !== 'King safety' && phase !== 'Opening') theme = 'Missed tactic';
      const bestMove = before.bestMove && before.bestMove !== '(none)' ? before.bestMove : '';
      const bestMoveSan = uciToSan(positions[i].fen, bestMove);
      const pvSan = uciPvToSan(positions[i].fen, before.pv || '');
      const explanation = explainMove(move, loss, severity, theme, bestMoveSan || bestMove, phase);
      const entry = {
        index: i,
        isUserMove,
        san: move.san,
        loss,
        severity: isUserMove ? severity : 'Opponent move',
        theme: isUserMove && severity !== 'Good' ? theme : null,
        phase,
        bestMove: bestMoveSan || bestMove,
        bestMoveUci: bestMove,
        bestMoveSan,
        pv: pvSan || before.pv || '',
        explanation: isUserMove ? explanation : '',
        evalBefore: before,
        evalAfter: after,
        accuracy: Math.max(0, Math.min(100, 100 - loss/14))
      };
      analysedMoves.push(entry);
      if (isUserMove && ['Blunder', 'Mistake', 'Inaccuracy'].includes(severity)) {
        const boardBefore = new Chess(positions[i].fen);
        let bestMoveSan = '';
        try {
          if (bestMove && bestMove.length >= 4) {
            const best = boardBefore.move({ from: bestMove.slice(0,2), to: bestMove.slice(2,4), promotion: bestMove[4] || 'q' });
            bestMoveSan = best?.san || '';
          }
        } catch {}
        mistakes.push({
          id: `${game.id}-${i}`,
          gameId: game.id,
          fen: positions[i].fen,
          move: move.san,
          san: move.san,
          severity,
          theme,
          loss,
          explanation,
          bestMove,
          bestMoveSan,
          pv: pvSan || before.pv,
          due: new Date().toISOString(),
          createdAt: new Date().toISOString()
        });
      }
    }
    state.gameAnalysis[game.id] = { depth, moves: analysedMoves, mistakes, completedAt: new Date().toISOString() };
    state.blunders = [...state.blunders.filter(m => m.gameId !== game.id), ...mistakes];
    state.openings = aggregateOpenings();
    state.engineStatus = 'Stockfish ready';
    save();
    state.analysisBusy = false;
    state.view = 'analysis';
    state.selectedGameId = game.id;
    state.activeMoveIndex = 0;
    renderShell();
    toast(`Analysis complete. ${mistakes.length} review positions saved.`);
  } catch (error) {
    state.analysisBusy = false;
    state.engineStatus = 'Engine unavailable';
    console.error(error);
    renderShell();
    toast(error.message || 'Analysis could not be completed.');
  }
}

function explainMove(move, loss, severity, theme, bestMove, phase) {
  if (severity === 'Good') {
    return `This ${phase.toLowerCase()} move kept the position stable. The engine found no major evaluation drop, so your plan is holding together.`;
  }
  const piece = ({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' })[move.piece || ''] || 'piece';
  if (theme === 'Hanging piece') return `This move left your ${piece} vulnerable. Before moving, check whether the destination square is protected and what forcing captures your opponent has. The position shifted by roughly ${(loss/100).toFixed(1)} pawns.`;
  if (theme === 'King safety') return `Your king became more exposed after this move. Check the opponent’s forcing checks and attacking routes before spending a tempo elsewhere.`;
  if (theme === 'Opening choice') return `This early move gave away some opening value. Prioritise development, central control and king safety before launching a flank plan. A stronger continuation begins with ${bestMove || 'a developing move'}.`;
  return `This was a ${severity.toLowerCase()} because it missed a stronger continuation. Look for forcing checks, captures and threats first. The engine preferred ${bestMove || 'a different move'}; the evaluation shifted by about ${(loss/100).toFixed(1)} pawns.`;
}

async function analysePosition(index) {
  const game = getSelectedGame();
  if (!game) return;
  try {
    state.engineStatus = 'Analysing position';
    renderShell();
    await engine.init();
    const replay = new Chess();
    const moves = game.moves;
    for (let i=0; i<index && i<moves.length; i++) replay.move(moves[i].san);
    const evaluation = await engine.evaluate(replay.fen(), 12);
    const score = formatScore(evaluation, replay.turn() === 'w' ? 1 : -1);
    toast(`Position evaluation: ${score} · depth ${evaluation.depth}`);
    state.engineStatus = 'Stockfish ready';
  } catch (error) { toast(error.message || 'Could not analyse this position.'); }
  renderShell();
}

function scheduleMistake(mistake, grade) {
  const intervals = { again: 10*60*1000, hard: 1*86400000, good: 3*86400000, easy: 7*86400000 };
  mistake.due = new Date(Date.now() + intervals[grade]).toISOString();
  mistake.repetitions = (mistake.repetitions || 0) + (grade === 'again' ? 0 : 1);
  save();
}

function renderReviewModal(mistake) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal review-modal" onclick="event.stopPropagation()"><button class="modal-close" data-action="close-modal">×</button><span class="eyebrow">MISTAKE REVIEW</span><h2>Can you find the better move?</h2><p>${escapeHtml(mistake.explanation || 'Look for the strongest continuation.')}</p><div class="review-board">${renderBoard(new Chess(mistake.fen).board(), null, 'review-chessboard')}</div><div class="review-best"><span>ENGINE MOVE</span><b>${escapeHtml(mistake.bestMoveSan || mistake.bestMove || 'Use the engine to reveal')}</b><small>${escapeHtml(mistake.pv || '')}</small></div><div class="review-grades"><button data-action="grade-review" data-grade="again" data-id="${escapeHtml(mistake.id)}"><b>Again</b><small>10 min</small></button><button data-action="grade-review" data-grade="hard" data-id="${escapeHtml(mistake.id)}"><b>Hard</b><small>1 day</small></button><button data-action="grade-review" data-grade="good" data-id="${escapeHtml(mistake.id)}"><b>Good</b><small>3 days</small></button><button data-action="grade-review" data-grade="easy" data-id="${escapeHtml(mistake.id)}"><b>Easy</b><small>7 days</small></button></div></div></div>`;
}

function setView(view) {
  state.view = view;
  renderShell();
}

function wireViewButtons() {
  $$('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
}

function handleAction(action, target) {
  const game = getSelectedGame();
  switch (action) {
    case 'open-import': renderImportModal(); break;
    case 'close-modal': $('#modal-root').innerHTML = ''; break;
    case 'training-tab': state.trainingMode = target.dataset.mode; if (state.trainingMode === 'openings' && !state.openingDrill) prepareOpeningDrill(); renderTraining(); break;
    case 'submit-opening': submitOpeningMove(); break;
    case 'hint-opening': hintOpeningMove(); break;
    case 'next-opening': prepareOpeningDrill(getOpeningDrillGame(state.openingDrill?.gameId)); renderOpeningDrill(); break;
    case 'reset-practice': resetPractice(); break;
    case 'reveal-practice': revealPracticeHint(); break;
    case 'flip-practice': toast('Board orientation is fixed to White for this training build.'); break;
    case 'select-game': state.selectedGameId = target.dataset.id; state.activeMoveIndex = 0; setView('analysis'); break;
    case 'analyse-game': analyseGame(target.dataset.id); break;
    case 'analyse-batch': analyseBatch(); break;
    case 'jump-move': state.activeMoveIndex = Number(target.dataset.index); renderAnalysis(); break;
    case 'first-move': state.activeMoveIndex = 0; renderAnalysis(); break;
    case 'prev-move': state.activeMoveIndex = Math.max(0, state.activeMoveIndex-1); renderAnalysis(); break;
    case 'next-move': state.activeMoveIndex = Math.min((game?.moves.length || 1)-1, state.activeMoveIndex+1); renderAnalysis(); break;
    case 'last-move': state.activeMoveIndex = Math.max(0, (game?.moves.length || 1)-1); renderAnalysis(); break;
    case 'analyse-position': analysePosition(Number(target.dataset.index)); break;
    case 'review-mistake': {
      const mistake = allMistakes().find(m => m.id === target.dataset.id);
      if (mistake) renderReviewModal(mistake);
      break;
    }
    case 'grade-review': {
      const mistake = allMistakes().find(m => m.id === target.dataset.id);
      if (mistake) scheduleMistake(mistake, target.dataset.grade);
      $('#modal-root').innerHTML = '';
      toast(`Next review scheduled: ${target.dataset.grade}.`);
      renderShell();
      break;
    }
    case 'submit-training': {
      const mistakes = allMistakes();
      const active = mistakes.filter(m => !m.due || new Date(m.due) <= new Date())[state.trainingIndex % Math.max(1, mistakes.length)];
      submitTrainingMove(active);
      break;
    }
    case 'reveal-training': {
      const mistakes = allMistakes();
      const active = mistakes.filter(m => !m.due || new Date(m.due) <= new Date())[state.trainingIndex % Math.max(1, mistakes.length)];
      if (active) {
        const best = active.bestMoveSan || active.bestMove || 'Check, capture, threat';
        state.trainingMessage = `Hint: look for ${best}. Recalculate the opponent’s strongest reply after your move.`;
        $('#training-feedback').textContent = state.trainingMessage;
      }
      break;
    }
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  event.preventDefault();
  handleAction(target.dataset.action, target);
});

function loadDemo() {
  const demoPgns = [
`[Event "Rapid Game"]\n[Site "Chess.com"]\n[Date "2026.10.24"]\n[Round "-"]\n[White "TempoLearner"]\n[Black "QuietBishop"]\n[Result "1-0"]\n[WhiteElo "1486"]\n[BlackElo "1510"]\n[ECO "D30"]\n[Opening "Queen's Gambit Declined"]\n[TimeControl "600+5"]\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 7. Bh4 b6 8. cxd5 exd5 9. Bd3 Bb7 10. O-O Nbd7 11. Rc1 c5 12. dxc5 bxc5 13. Bb1 Re8 14. Qc2 Nf8 15. Rfd1 Rc8 16. Bxf6 Bxf6 17. Nxd5 Bxd5 18. e4 Bxe4 19. Rxd8 Bxc2 20. Rxe8 Rxe8 21. Bxc2 Bxb2 22. Rb1 Bd4 23. Kf1 Ne6 24. Rb7 a5 25. Bb3 a4 26. Bxa4 Ra8 27. Bb3 Bf6 28. Nd2 Nd4 29. Bxf7+ Kh7 30. Ne4 Be5 31. Nxc5 Rc8 32. Nd3 Bf6 33. g3 Rc2 34. a4 Rd2 35. Nf4 Nf3 36. Bg6+ Kh8 37. Rb8+ Bd8 38. Ne6 Nxh2+ 39. Kg2 Ng4 40. Rxd8+ Rxd8 41. Nxd8 1-0`,
`[Event "Rapid Game"]\n[Site "Chess.com"]\n[Date "2026.10.22"]\n[Round "-"]\n[White "CentrePawn"]\n[Black "TempoLearner"]\n[Result "0-1"]\n[WhiteElo "1502"]\n[BlackElo "1484"]\n[ECO "B20"]\n[Opening "Sicilian Defence"]\n[TimeControl "600+5"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 Be7 9. Qd2 O-O 10. O-O-O Nbd7 11. g4 b5 12. g5 b4 13. Ne2 Ne8 14. h4 a5 15. Kb1 a4 16. Nbc1 b3 17. cxb3 axb3 18. a3 Nb6 19. Nc3 Nc4 20. Bxc4 Bxc4 21. Nd5 Bxd5 22. Qxd5 Nc7 23. Qxb3 Ne6 24. Ne2 Rb8 25. Qd3 Qa5 26. Bd2 Qb6 27. Bc3 Nc5 28. Qc2 Na4 29. Ka2 Nxc3+ 30. Nxc3 Rfc8 31. Qd3 Qb3+ 32. Ka1 Qxb2# 0-1`,
`[Event "Blitz Game"]\n[Site "Chess.com"]\n[Date "2026.10.20"]\n[Round "-"]\n[White "TempoLearner"]\n[Black "EndgameFox"]\n[Result "1/2-1/2"]\n[WhiteElo "1481"]\n[BlackElo "1460"]\n[ECO "C50"]\n[Opening "Italian Game"]\n[TimeControl "300+2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Nf6 5. c3 d6 6. O-O O-O 7. Re1 a6 8. Bb3 Ba7 9. Nbd2 h6 10. Nf1 Re8 11. Ng3 Be6 12. Bc2 Qd7 13. h3 d5 14. Qe2 Rad8 15. Be3 d4 16. cxd4 Nxd4 17. Nxd4 exd4 18. Bd2 c5 19. f4 b5 20. f5 Bd5 21. Nh5 Nxh5 22. Qxh5 c4 23. f6 d3 24. fxg7 dxc2 25. Bxh6 Qe6 26. exd5 Qg6 27. Qxg6 fxg6 28. Rac1 Rxd5 29. Rxc2 1/2-1/2`,
`[Event "Rapid Game"]\n[Site "Chess.com"]\n[Date "2026.10.18"]\n[Round "-"]\n[White "KnightShift"]\n[Black "TempoLearner"]\n[Result "1-0"]\n[WhiteElo "1520"]\n[BlackElo "1478"]\n[ECO "B12"]\n[Opening "Caro-Kann Defence"]\n[TimeControl "600+5"]\n\n1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 5. Be2 c5 6. O-O Nc6 7. Be3 Qb6 8. Nc3 cxd4 9. Nxd4 Nxd4 10. Bxd4 Bc5 11. Na4 Bxd4 12. Nxb6 Bxb6 13. Bb5+ Kf8 14. c4 Ne7 15. cxd5 Nxd5 16. Rc1 g6 17. Bc4 Rd8 18. Bxd5 Rxd5 19. Qe2 Bd3 20. Qf3 Bxf1 21. Qxd5 exd5 22. Rc8+ Kg7 23. Rxh8 Kxh8 24. Kxf1 Bd4 25. f4 Bxb2 26. Ke2 Kg7 27. Kd3 h5 28. a4 Kf6 29. h3 Kf5 30. g3 g5 31. fxg5 Bxe5 32. h4 Bxg3 33. Ke3 Bxh4 34. Kf3 Bxg5 35. a5 d4 36. a6 bxa6 37. Ke2 Ke4 38. Kd1 d3 39. Ke1 Ke3 40. Kd1 d2 41. Kc2 Ke2 1-0`
  ];
  const metas = [
    { username:'TempoLearner', white:{ username:'TempoLearner',rating:1486}, black:{username:'QuietBishop',rating:1510}, userColor:'w',timeClass:'rapid',date:'2026-10-24T17:00:00.000Z',opening:'Queen’s Gambit Declined' },
    { username:'TempoLearner', white:{ username:'CentrePawn',rating:1502}, black:{username:'TempoLearner',rating:1484}, userColor:'b',timeClass:'rapid',date:'2026-10-22T14:00:00.000Z',opening:'Sicilian Defence' },
    { username:'TempoLearner', white:{ username:'TempoLearner',rating:1481}, black:{username:'EndgameFox',rating:1460}, userColor:'w',timeClass:'blitz',date:'2026-10-20T19:00:00.000Z',opening:'Italian Game' },
    { username:'TempoLearner', white:{ username:'KnightShift',rating:1520}, black:{username:'TempoLearner',rating:1478}, userColor:'b',timeClass:'rapid',date:'2026-10-18T18:00:00.000Z',opening:'Caro-Kann Defence' }
  ];
  state.games = demoPgns.map((pgn, i) => {
    try { return parseOnePgn(pgn, { ...metas[i], id:`demo-game-${i+1}` }, 'TempoLearner'); }
    catch (error) { console.warn('A sample game could not be parsed:', error); return null; }
  }).filter(Boolean);
  state.username = 'TempoLearner';
  state.profile = { username: 'TempoLearner', rating: 1486 };
  state.selectedGameId = state.games[0].id;
  state.gameAnalysis = {};
  state.blunders = [
    {id:'demo-1',gameId:'demo-game-1',fen:'r1bqk2r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 4',move:'Bxf7+',san:'Bxf7+',severity:'Blunder',theme:'Hanging piece',loss:380,explanation:'The bishop was left undefended after the king recaptured. Check your opponent’s forcing replies before taking material.',bestMove:'d7-d6',bestMoveSan:'d6',pv:'d6 d3 Na5',due:new Date().toISOString()},
    {id:'demo-2',gameId:'demo-game-2',fen:'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7',move:'Qd2?',san:'Qd2?',severity:'Mistake',theme:'Missed tactic',loss:210,explanation:'A simple knight fork was available. Look for checks and captures before committing your queen.',bestMove:'d3-d4',bestMoveSan:'d4',pv:'d4 exd4 Nxd4',due:new Date().toISOString()},
    {id:'demo-3',gameId:'demo-game-3',fen:'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 1 2',move:'h3?!',san:'h3?!',severity:'Inaccuracy',theme:'Opening choice',loss:95,explanation:'This move spends a tempo without solving a central-development problem.',bestMove:'d2-d4',bestMoveSan:'d4',pv:'d4 exd4 Nxd4',due:new Date().toISOString()}
  ];
  state.demo = true;
  save();
}

function bindGlobal() {
  engine.onStatus = status => {
    state.engineStatus = status;
    const nodes = $$('.engine-pill, .engine-card');
    nodes.forEach(node => {
      const dot = $('.engine-dot', node);
      if (dot) dot.classList.toggle('online', status.includes('ready'));
      const label = node.querySelector('b') || node;
      if (label) label.textContent = status;
    });
  };
}

function init() {
  const restored = restore();
  if (!restored) loadDemo();
  bindGlobal();
  if (!state.selectedGameId && state.games.length) state.selectedGameId = state.games[0].id;
  renderShell();
}

init();
