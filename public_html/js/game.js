(() => {
    'use strict';

    const root = document.getElementById('game');
    const DIFFICULTIES = JSON.parse(root.dataset.difficulties);
    const boardEl = document.getElementById('board');
    const minesLeftEl = document.getElementById('mines-left');
    const timerEl = document.getElementById('timer');
    const resultEl = document.getElementById('result');
    const resultText = document.getElementById('result-text');
    const resultGuest = document.getElementById('result-guest');
    const csrf = document.querySelector('meta[name="csrf-token"]').content;

    const HIDDEN = 0, REVEALED = 1, FLAGGED = 2;

    let difficulty = 'beginner';
    try {
        const saved = localStorage.getItem('difficulty');
        if (saved && DIFFICULTIES[saved]) difficulty = saved;
    } catch (e) { /* storage unavailable */ }

    let cols, rows, mineCount, mines, adjacent, state, cells;
    let placed, over, revealedCount, flagCount, startedAt, tick;

    function newGame() {
        ({ cols, rows, mines: mineCount } = DIFFICULTIES[difficulty]);
        const n = cols * rows;
        mines = new Uint8Array(n);
        adjacent = new Uint8Array(n);
        state = new Uint8Array(n);
        placed = false;
        over = false;
        revealedCount = 0;
        flagCount = 0;
        startedAt = null;
        clearInterval(tick);

        timerEl.textContent = '0.0';
        minesLeftEl.textContent = mineCount;
        resultEl.hidden = true;
        resultEl.className = 'result';
        resultGuest.hidden = true;

        boardEl.style.setProperty('--cols', cols);
        boardEl.classList.remove('over');
        const frag = document.createDocumentFragment();
        cells = [];
        for (let i = 0; i < n; i++) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cell';
            b.dataset.i = i;
            b.setAttribute('aria-label', 'Hidden');
            cells.push(b);
            frag.appendChild(b);
        }
        boardEl.replaceChildren(frag);

        document.querySelectorAll('[data-difficulty]').forEach((b) => {
            b.classList.toggle('active', b.dataset.difficulty === difficulty);
        });
    }

    function neighbours(i) {
        const x = i % cols, y = (i - x) / cols, out = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) out.push(ny * cols + nx);
            }
        }
        return out;
    }

    // Mines are laid after the first click so it always opens a clear area.
    function placeMines(safe) {
        const banned = new Set([safe, ...neighbours(safe)]);
        const pool = [];
        for (let i = 0; i < cols * rows; i++) if (!banned.has(i)) pool.push(i);
        for (let k = 0; k < mineCount; k++) {
            const j = k + Math.floor(Math.random() * (pool.length - k));
            [pool[k], pool[j]] = [pool[j], pool[k]];
            mines[pool[k]] = 1;
        }
        for (let i = 0; i < cols * rows; i++) {
            adjacent[i] = neighbours(i).reduce((sum, nb) => sum + mines[nb], 0);
        }
        placed = true;
        startedAt = performance.now();
        tick = setInterval(() => {
            timerEl.textContent = ((performance.now() - startedAt) / 1000).toFixed(1);
        }, 100);
    }

    function reveal(start) {
        const stack = [start];
        while (stack.length) {
            const i = stack.pop();
            if (state[i] !== HIDDEN) continue;
            if (mines[i]) return lose(i);

            state[i] = REVEALED;
            revealedCount++;
            const el = cells[i];
            el.classList.add('open');
            if (adjacent[i]) {
                el.textContent = adjacent[i];
                el.classList.add('n' + adjacent[i]);
                el.setAttribute('aria-label', adjacent[i] + ' adjacent');
            } else {
                el.setAttribute('aria-label', 'Empty');
                stack.push(...neighbours(i));
            }
        }
        if (revealedCount === cols * rows - mineCount) win();
    }

    function toggleFlag(i) {
        if (state[i] === REVEALED) return;
        const flagged = state[i] === FLAGGED;
        state[i] = flagged ? HIDDEN : FLAGGED;
        flagCount += flagged ? -1 : 1;
        cells[i].classList.toggle('flag', !flagged);
        cells[i].setAttribute('aria-label', flagged ? 'Hidden' : 'Flagged');
        minesLeftEl.textContent = mineCount - flagCount;
    }

    // Clicking a satisfied number opens everything around it that isn't flagged.
    function chord(i) {
        const nbs = neighbours(i);
        if (nbs.filter((nb) => state[nb] === FLAGGED).length !== adjacent[i]) return;
        for (const nb of nbs) {
            if (over) break;
            if (state[nb] === HIDDEN) reveal(nb);
        }
    }

    function finish() {
        over = true;
        clearInterval(tick);
        boardEl.classList.add('over');
        const ms = Math.max(1, Math.round(performance.now() - startedAt));
        timerEl.textContent = (ms / 1000).toFixed(2);
        return ms;
    }

    function lose(hit) {
        finish();
        for (let i = 0; i < cols * rows; i++) {
            if (mines[i] && state[i] !== FLAGGED) cells[i].classList.add('mine');
            if (!mines[i] && state[i] === FLAGGED) cells[i].classList.add('wrong');
        }
        cells[hit].classList.add('hit');
        showResult('lost', 'Boom. That was a mine.');
    }

    function win() {
        const ms = finish();
        for (let i = 0; i < cols * rows; i++) {
            if (mines[i] && state[i] !== FLAGGED) cells[i].classList.add('flag');
        }
        minesLeftEl.textContent = 0;
        const time = (ms / 1000).toFixed(2);
        showResult('won', `Cleared in ${time}s.`);
        submit(ms, time);
    }

    function showResult(kind, text) {
        resultEl.className = 'result ' + kind;
        resultText.textContent = text;
        resultEl.hidden = false;
    }

    async function submit(ms, time) {
        try {
            const res = await fetch(root.dataset.scoreUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrf,
                },
                body: JSON.stringify({ difficulty, time_ms: ms }),
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (data.saved) {
                resultText.textContent = `Cleared in ${time}s. Saved to the leaderboard.`;
            } else {
                resultGuest.hidden = false;
            }
        } catch (e) {
            resultText.textContent = `Cleared in ${time}s. The time could not be saved (${e.message}).`;
        }
    }

    function cellIndex(target) {
        const el = target.closest('.cell');
        return el ? Number(el.dataset.i) : null;
    }

    // Touch: a long press flags, and the click that follows it is ignored.
    let pressTimer = null, suppressClick = false;

    boardEl.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' || over) return;
        const i = cellIndex(e.target);
        if (i === null) return;
        pressTimer = setTimeout(() => {
            suppressClick = true;
            toggleFlag(i);
            if (navigator.vibrate) navigator.vibrate(15);
        }, 400);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'pointermove']) {
        boardEl.addEventListener(type, (e) => {
            if (type === 'pointermove' && Math.abs(e.movementX) + Math.abs(e.movementY) < 6) return;
            clearTimeout(pressTimer);
        });
    }

    boardEl.addEventListener('click', (e) => {
        if (suppressClick) { suppressClick = false; return; }
        const i = cellIndex(e.target);
        if (i === null || over) return;
        if (state[i] === FLAGGED) return;
        if (state[i] === REVEALED) return chord(i);
        if (!placed) placeMines(i);
        reveal(i);
    });

    boardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (suppressClick) return; // long press already handled it
        const i = cellIndex(e.target);
        if (i !== null && !over) toggleFlag(i);
    });

    // Keyboard: F flags the focused cell (Enter/Space reveal via click).
    boardEl.addEventListener('keydown', (e) => {
        const i = cellIndex(e.target);
        if (i === null) return;
        if (e.key === 'f' || e.key === 'F') { if (!over) toggleFlag(i); return; }
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
        if (!(e.key in moves)) return;
        const x = i % cols;
        if ((e.key === 'ArrowLeft' && x === 0) || (e.key === 'ArrowRight' && x === cols - 1)) return;
        const next = cells[i + moves[e.key]];
        if (next) { e.preventDefault(); next.focus(); }
    });

    document.querySelectorAll('[data-difficulty]').forEach((b) => {
        b.addEventListener('click', () => {
            difficulty = b.dataset.difficulty;
            try { localStorage.setItem('difficulty', difficulty); } catch (e) { /* ignore */ }
            newGame();
        });
    });
    document.getElementById('new-game').addEventListener('click', newGame);

    newGame();
})();
