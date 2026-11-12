const ENGINE_URL = '/engine/stockfish-19-lite-single.js';

export class StockfishEngine {
  constructor() {
    this.worker = null;
    this.readyPromise = null;
    this.pending = null;
    this.failed = false;
    this.onStatus = () => {};
  }

  async init() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      try {
        this.onStatus('Loading Stockfish 19…');
        this.worker = new Worker(ENGINE_URL);
        const timeout = setTimeout(() => reject(new Error('Stockfish did not start. Check that the engine files exist in public/engine.')), 25000);
        this.worker.onmessage = (event) => {
          const line = String(event.data || '');
          if (line === 'uciok') {
            this.worker.postMessage('setoption name Threads value 1');
            this.worker.postMessage('setoption name Hash value 32');
            this.worker.postMessage('isready');
          } else if (line === 'readyok') {
            clearTimeout(timeout);
            this.onStatus('Stockfish ready');
            resolve(true);
          } else if (this.pending) {
            if (line.startsWith('info ')) {
              const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
              const depthMatch = line.match(/depth (\d+)/);
              const pvMatch = line.match(/ pv (.+)$/);
              if (scoreMatch) {
                this.pending.score = {
                  type: scoreMatch[1],
                  value: Number(scoreMatch[2]),
                  depth: depthMatch ? Number(depthMatch[1]) : 0,
                  pv: pvMatch ? pvMatch[1].trim() : ''
                };
              }
            } else if (line.startsWith('bestmove ')) {
              const bestMove = line.split(/\s+/)[1];
              const done = this.pending;
              this.pending = null;
              done.resolve({ ...(done.score || { type: 'cp', value: 0, depth: 0, pv: '' }), bestMove });
            }
          }
        };
        this.worker.onerror = (error) => {
          clearTimeout(timeout);
          this.failed = true;
          this.onStatus('Engine unavailable');
          reject(error instanceof Error ? error : new Error('Could not load the Stockfish worker.'));
        };
        this.worker.postMessage('uci');
      } catch (error) {
        this.failed = true;
        reject(error);
      }
    });
    return this.readyPromise;
  }

  async evaluate(fen, depth = 9, skill = null) {
    await this.init();
    if (this.pending) throw new Error('The engine is already analysing a position.');
    if (skill !== null) this.worker.postMessage(`setoption name Skill Level value ${Math.max(0, Math.min(20, Number(skill)))}`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          this.worker.postMessage('stop');
          reject(new Error('Engine search timed out.'));
        }
      }, 45000);
      this.pending = {
        score: null,
        resolve: (result) => { clearTimeout(timeout); resolve(result); },
        reject
      };
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${Math.max(5, Math.min(16, Number(depth)))}`);
    });
  }

  async play(fen, skill = 8) {
    const result = await this.evaluate(fen, 9, skill);
    return result.bestMove;
  }

  terminate() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.pending = null;
    this.onStatus('Engine offline');
  }
}

export function scoreToCp(score) {
  if (!score) return 0;
  if (score.type === 'mate') return Math.sign(score.value || 1) * (10000 - Math.min(99, Math.abs(score.value)) * 10);
  return score.value;
}

export function formatScore(score, perspective = 1) {
  if (!score) return '—';
  const sign = perspective < 0 ? -1 : 1;
  if (score.type === 'mate') {
    const value = score.value * sign;
    return value > 0 ? `M${value}` : `−M${Math.abs(value)}`;
  }
  const value = (score.value * sign) / 100;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}
