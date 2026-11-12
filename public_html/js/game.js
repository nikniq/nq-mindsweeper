(() => {
    'use strict';

    const root = document.getElementById('game');
    const DIFFICULTIES = JSON.parse(root.dataset.difficulties);
    const boardEl = document.getElementById('board');
    const boardWrap = boardEl.parentElement;
    const minesLeftEl = document.getElementById('mines-left');
    const timerEl = document.getElementById('timer');
    const resultEl = document.getElementById('result');
    const resultText = document.getElementById('result-text');
    const resultGuest = document.getElementById('result-guest');
    const statsEl = document.getElementById('stats');
    const flagModeBtn = document.getElementById('flag-mode');
    const musicBtn = document.getElementById('music');
    const soundBtn = document.getElementById('sound');
    const hintBtn = document.getElementById('hint');
    const tipEl = document.getElementById('tip');
    const resultDetail = document.getElementById('result-detail');
    const resultShare = document.getElementById('result-share');
    const shareBtn = document.getElementById('share');
    const audio = window.GameAudio;
    const DAILY = 'daily', DAY = root.dataset.day;
    const HINT_PENALTY_MS = 10000;
    const csrf = document.querySelector('meta[name="csrf-token"]').content;

    const HIDDEN = 0, REVEALED = 1, FLAGGED = 2;
    const MAX_CELL = 32, MIN_CELL = 18, GAP = 2;

    function load(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            return fallback; // storage unavailable or corrupt
        }
    }

    function save(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }

    let difficulty = 'beginner';
    try {
        // Stored as a bare string by earlier versions, so it is not read as JSON.
        const saved = localStorage.getItem('difficulty');
        if (saved && DIFFICULTIES[saved]) difficulty = saved;
    } catch (e) { /* storage unavailable */ }

    // Per-difficulty record kept in this browser: played, won, best (ms), streak.
    const stats = load('stats', {}) || {};
    let flagMode = false;

    let cols, rows, mineCount, mines, adjacent, state, cells;
    let placed, over, revealedCount, flagCount, startedAt, tick, focusIdx;
    // startIdx: the cell a daily board must be opened from. ranked: whether
    // this run counts (a daily board only counts the first time it is played).
    let startIdx, ranked, penaltyMs, hintsUsed, clicks, shareText;

    // Small seeded generator, so a given day produces the same board for everyone.
    function seededRandom(text) {
        let seed = 2166136261;
        for (const ch of text) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
        return () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function setTip(text) {
        tipEl.textContent = text;
        tipEl.hidden = !text;
    }

    const elapsed = () => performance.now() - startedAt + penaltyMs;

    function record() {
        const s = stats[difficulty] || {};
        return (stats[difficulty] = {
            played: s.played || 0,
            won: s.won || 0,
            best: s.best || null,
            streak: s.streak || 0,
        });
    }

    function renderStats() {
        const s = record();
        if (!s.played) {
            statsEl.textContent = `No finished games on ${DIFFICULTIES[difficulty].label} yet.`;
            return;
        }
        const parts = [
            s.best ? `Best ${(s.best / 1000).toFixed(2)}s` : 'No win yet',
            `Won ${s.won} of ${s.played} (${Math.round((s.won / s.played) * 100)}%)`,
        ];
        if (s.streak > 1) parts.push(`Streak ${s.streak}`);
        statsEl.textContent = parts.join(' · ');
    }

    // Returns true when the win beat the previous best time.
    function recordResult(won, ms) {
        if (difficulty === DAILY) {
            // Replaying a board you have already seen says nothing about your play.
            if (!ranked) return false;
            save('daily', { day: DAY, won, ms: won ? ms : null });
        }
        const s = record();
        s.played++;
        let isBest = false;
        if (won) {
            s.won++;
            s.streak++;
            isBest = s.best === null || ms < s.best;
            if (isBest) s.best = ms;
        } else {
            s.streak = 0;
        }
        save('stats', stats);
        renderStats();
        return isBest;
    }

    function newGame() {
        // Walking away from a game in progress counts as a loss.
        if (placed && !over) recordResult(false);

        const hadFocus = boardEl.contains(document.activeElement);

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
        penaltyMs = 0;
        hintsUsed = 0;
        clicks = 0;
        ranked = true;
        startIdx = null;
        clearInterval(tick);

        if (difficulty === DAILY) {
            startIdx = Math.floor(seededRandom(DAY + ':start')() * n);
            const played = load('daily', null);
            ranked = !played || played.day !== DAY;
            setTip(ranked
                ? `Today's board (${DAY}) is the same for everyone. Start on the marked cell. Only your first attempt counts.`
                : 'You have already played today\'s board, so this run is practice and is not ranked. A new board arrives at midnight UTC.');
        } else {
            setTip('');
        }
        resultDetail.hidden = true;
        resultShare.hidden = true;

        timerEl.textContent = '0.0';
        minesLeftEl.textContent = mineCount;
        resultEl.hidden = true;
        resultEl.className = 'result';
        resultGuest.hidden = true;

        boardEl.style.setProperty('--cols', cols);
        boardEl.classList.remove('over', 'won', 'lost');
        focusIdx = startIdx ?? Math.floor(rows / 2) * cols + Math.floor(cols / 2);
        const frag = document.createDocumentFragment();
        cells = [];
        for (let i = 0; i < n; i++) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cell';
            b.dataset.i = i;
            // Roving tabindex: the board is one tab stop, arrows move inside it.
            b.tabIndex = i === focusIdx ? 0 : -1;
            b.setAttribute('aria-label', 'Hidden');
            cells.push(b);
            frag.appendChild(b);
        }
        if (startIdx !== null) cells[startIdx].classList.add('start');
        boardEl.replaceChildren(frag);
        fitBoard();
        if (hadFocus) cells[focusIdx].focus();

        document.querySelectorAll('[data-difficulty]').forEach((b) => {
            const active = b.dataset.difficulty === difficulty;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', active);
        });
        renderStats();
    }

    // Shrink cells so the board fits the page width where it reasonably can.
    function fitBoard() {
        if (!cols) return;
        const chrome = 8 /* wrap padding */ + 18 /* board padding + border */ + (cols - 1) * GAP;
        const fit = Math.floor((boardWrap.clientWidth - chrome) / cols);
        const size = Math.max(MIN_CELL, Math.min(MAX_CELL, fit));
        boardEl.style.setProperty('--size', size + 'px');
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

    function distance(a, b) {
        const ax = a % cols, bx = b % cols;
        return Math.max(Math.abs(ax - bx), Math.abs((a - ax) / cols - (b - bx) / cols));
    }

    // Mines are laid after the first click so it always opens a clear area.
    function placeMines(safe) {
        const random = difficulty === DAILY ? seededRandom(DAY + ':mines') : Math.random;
        // Opening the daily board uses up the attempt, win or lose.
        if (difficulty === DAILY && ranked) save('daily', { day: DAY, won: false, ms: null });
        cells[safe].classList.remove('start');
        const banned = new Set([safe, ...neighbours(safe)]);
        const pool = [];
        for (let i = 0; i < cols * rows; i++) if (!banned.has(i)) pool.push(i);
        for (let k = 0; k < mineCount; k++) {
            const j = k + Math.floor(random() * (pool.length - k));
            [pool[k], pool[j]] = [pool[j], pool[k]];
            mines[pool[k]] = 1;
        }
        for (let i = 0; i < cols * rows; i++) {
            adjacent[i] = neighbours(i).reduce((sum, nb) => sum + mines[nb], 0);
        }
        placed = true;
        startedAt = performance.now();
        tick = setInterval(() => {
            timerEl.textContent = (elapsed() / 1000).toFixed(1);
        }, 100);
    }

    function reveal(start) {
        const before = revealedCount;
        const stack = [start];
        while (stack.length) {
            const i = stack.pop();
            if (state[i] !== HIDDEN) continue;
            if (mines[i]) return lose(i);

            state[i] = REVEALED;
            revealedCount++;
            const el = cells[i];
            // Opened areas ripple outwards from the cell that was clicked.
            el.style.animationDelay = Math.min(distance(start, i) * 18, 360) + 'ms';
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
        if (revealedCount === cols * rows - mineCount) return win();
        if (revealedCount - before > 1) audio.play('flood');
        else audio.play('reveal', adjacent[start]);
    }

    function toggleFlag(i) {
        if (state[i] === REVEALED) return;
        const flagged = state[i] === FLAGGED;
        state[i] = flagged ? HIDDEN : FLAGGED;
        flagCount += flagged ? -1 : 1;
        if (placed) clicks++;
        cells[i].classList.toggle('flag', !flagged);
        cells[i].setAttribute('aria-label', flagged ? 'Hidden' : 'Flagged');
        minesLeftEl.textContent = mineCount - flagCount;
        audio.play(flagged ? 'unflag' : 'flag');
    }

    // Clicking a satisfied number opens everything around it that isn't flagged.
    // If the flags don't add up yet, the cells in question flash instead.
    function chord(i) {
        if (!adjacent[i]) return;
        const nbs = neighbours(i);
        if (nbs.filter((nb) => state[nb] === FLAGGED).length !== adjacent[i]) {
            for (const nb of nbs) {
                if (state[nb] !== HIDDEN) continue;
                const el = cells[nb];
                el.classList.add('hint');
                setTimeout(() => el.classList.remove('hint'), 220);
            }
            audio.play('deny');
            return;
        }
        if (nbs.some((nb) => state[nb] === HIDDEN)) clicks++;
        for (const nb of nbs) {
            if (over) break;
            if (state[nb] === HIDDEN) reveal(nb);
        }
    }

    function finish(kind) {
        over = true;
        clearInterval(tick);
        boardEl.classList.add('over', kind);
        const ms = Math.max(1, Math.round(elapsed()));
        timerEl.textContent = (ms / 1000).toFixed(2);
        return ms;
    }

    function lose(hit) {
        finish('lost');
        for (let i = 0; i < cols * rows; i++) {
            if (mines[i] && state[i] !== FLAGGED) {
                cells[i].style.animationDelay = Math.min(distance(hit, i) * 35, 700) + 'ms';
                cells[i].classList.add('mine');
                cells[i].setAttribute('aria-label', 'Mine');
            }
            if (!mines[i] && state[i] === FLAGGED) {
                cells[i].classList.add('wrong');
                cells[i].setAttribute('aria-label', 'Wrong flag');
            }
        }
        cells[hit].classList.add('hit');
        recordResult(false);
        audio.play('lose');
        const cleared = Math.floor((revealedCount / (cols * rows - mineCount)) * 100);
        showResult('lost', `Boom. That was a mine. You had cleared ${cleared}% of the board.`);
    }

    function win() {
        const ms = finish('won');
        for (let i = 0; i < cols * rows; i++) {
            if (mines[i] && state[i] !== FLAGGED) {
                cells[i].classList.add('flag');
                cells[i].setAttribute('aria-label', 'Flagged');
            }
        }
        minesLeftEl.textContent = 0;
        audio.play('win');
        const time = (ms / 1000).toFixed(2);
        const hints = hintsUsed
            ? ` (including ${hintsUsed} ${hintsUsed === 1 ? 'hint' : 'hints'}, +${(hintsUsed * HINT_PENALTY_MS) / 1000}s)`
            : '';
        let summary = `Cleared in ${time}s${hints}.`;
        const practice = difficulty === DAILY && !ranked;
        if (practice) summary += ' Practice run, not ranked.';
        else if (recordResult(true, ms) && difficulty !== DAILY) summary += ' New personal best!';
        showResult('won', summary);

        // 3BV is the fewest clicks the board could be cleared in.
        const needed = minimumClicks();
        resultDetail.textContent = `Board difficulty (3BV) ${needed} · ${(needed / (ms / 1000)).toFixed(2)} per second · `
            + `${clicks} clicks · ${Math.min(100, Math.round((needed / clicks) * 100))}% efficient`;
        resultDetail.hidden = false;

        if (difficulty === DAILY && ranked) {
            shareText = `${root.dataset.app} daily ${DAY}: cleared in ${time}s${hints}. ${location.origin}`;
            shareBtn.textContent = 'Share result';
            resultShare.hidden = false;
        }
        if (!practice) submit(ms, summary);
    }

    function minimumClicks() {
        const n = cols * rows, seen = new Uint8Array(n);
        let count = 0;
        // Each connected empty area opens with one click, numbers on its edge included.
        for (let i = 0; i < n; i++) {
            if (mines[i] || adjacent[i] || seen[i]) continue;
            count++;
            const stack = [i];
            seen[i] = 1;
            while (stack.length) {
                for (const nb of neighbours(stack.pop())) {
                    if (seen[nb]) continue;
                    seen[nb] = 1;
                    if (!adjacent[nb]) stack.push(nb);
                }
            }
        }
        for (let i = 0; i < n; i++) if (!mines[i] && !seen[i]) count++;
        return count;
    }

    // Work out a move for the hint button. It uses only what the visible
    // numbers prove; when they prove nothing it falls back to a cell that
    // happens to be safe.
    function findHint() {
        const n = cols * rows;
        for (let i = 0; i < n; i++) {
            if (state[i] === FLAGGED && !mines[i]) return { i, kind: 'wrong' };
        }

        const mine = new Uint8Array(n), safe = new Uint8Array(n);
        for (let changed = true; changed;) {
            changed = false;
            for (let i = 0; i < n; i++) {
                if (state[i] !== REVEALED || !adjacent[i]) continue;
                const hidden = neighbours(i).filter((nb) => state[nb] !== REVEALED);
                const known = hidden.filter((nb) => mine[nb]).length;
                const rest = hidden.filter((nb) => !mine[nb] && !safe[nb]);
                if (!rest.length) continue;
                if (adjacent[i] - known === rest.length) {
                    rest.forEach((nb) => { mine[nb] = 1; });
                    changed = true;
                } else if (adjacent[i] === known) {
                    rest.forEach((nb) => { safe[nb] = 1; });
                    changed = true;
                }
            }
        }
        for (let i = 0; i < n; i++) if (safe[i]) return { i, kind: 'safe' };
        for (let i = 0; i < n; i++) if (mine[i] && state[i] !== FLAGGED) return { i, kind: 'mine' };

        let fallback = null;
        for (let i = 0; i < n; i++) {
            if (state[i] !== HIDDEN || mines[i]) continue;
            if (neighbours(i).some((nb) => state[nb] === REVEALED)) return { i, kind: 'guess' };
            fallback ??= i;
        }
        return fallback === null ? null : { i: fallback, kind: 'guess' };
    }

    const HINT_TEXT = {
        wrong: 'That flag is wrong: there is no mine under it.',
        safe: 'The highlighted cell is safe. The numbers around it prove it.',
        mine: 'The highlighted cell must be a mine. Flag it.',
        guess: 'The numbers do not settle anything here, so here is a cell that is safe.',
    };

    function mark(i, cls, ms = 3000) {
        const el = cells[i];
        el.classList.add(cls);
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        setTimeout(() => el.classList.remove(cls), ms);
    }

    function hint() {
        if (over) return;
        if (!placed) {
            if (startIdx !== null) mark(startIdx, 'hint');
            return setTip(startIdx !== null ? 'Start on the marked cell.' : 'Make your first move, then ask for a hint.');
        }
        const found = findHint();
        if (!found) return;
        hintsUsed++;
        penaltyMs += HINT_PENALTY_MS;
        mark(found.i, found.kind === 'safe' || found.kind === 'guess' ? 'hint-safe' : 'hint-mine');
        setTip(`${HINT_TEXT[found.kind]} (+${HINT_PENALTY_MS / 1000}s)`);
        audio.play('reveal', 5);
    }

    async function share() {
        try {
            if (navigator.share) {
                await navigator.share({ text: shareText });
            } else {
                await navigator.clipboard.writeText(shareText);
                shareBtn.textContent = 'Copied';
            }
        } catch (e) { /* cancelled or not permitted */ }
    }

    function showResult(kind, text) {
        resultEl.className = 'result ' + kind;
        resultText.textContent = text;
        resultEl.hidden = false;
    }

    async function submit(ms, summary) {
        try {
            const res = await fetch(root.dataset.scoreUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrf,
                },
                body: JSON.stringify({ difficulty, time_ms: ms, day: difficulty === DAILY ? DAY : null }),
            });
            if (!res.ok && res.status !== 409) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (data.saved) {
                resultText.textContent = `${summary} Saved to the leaderboard.`;
            } else if (data.reason === 'stale') {
                resultText.textContent = `${summary} A new daily board has started since you loaded the page, so this time was not saved. Reload to play it.`;
            } else if (data.reason === 'played') {
                resultText.textContent = `${summary} You already have a time for today's board, so this one was not saved.`;
            } else {
                resultGuest.hidden = false;
            }
        } catch (e) {
            resultText.textContent = `${summary} The time could not be saved (${e.message}).`;
        }
    }

    function setFlagMode(on) {
        flagMode = on;
        flagModeBtn.setAttribute('aria-pressed', on);
        boardEl.classList.toggle('flagging', on);
    }

    function setMusic(on) {
        audio.setMusic(on);
        musicBtn.setAttribute('aria-pressed', audio.music);
    }

    function setSound(on) {
        audio.setSound(on);
        soundBtn.setAttribute('aria-pressed', audio.sound);
    }

    function cellIndex(target) {
        const el = target.closest('.cell');
        return el ? Number(el.dataset.i) : null;
    }

    // Touch: a long press flags, and the click that follows it is ignored.
    let pressTimer = null, suppressClick = false;

    boardEl.addEventListener('pointerdown', (e) => {
        // Not every browser sends a click after a long press, so a stale
        // marker must not swallow the next tap.
        suppressClick = false;
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
        if (state[i] === REVEALED) return chord(i);
        if (flagMode) return toggleFlag(i);
        if (state[i] === FLAGGED) return;
        if (!placed) {
            if (startIdx !== null && i !== startIdx) {
                mark(startIdx, 'hint', 400);
                return audio.play('deny');
            }
            placeMines(i);
        }
        clicks++;
        reveal(i);
    });

    boardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (suppressClick) return; // long press already handled it
        const i = cellIndex(e.target);
        if (i !== null && !over) toggleFlag(i);
    });

    boardEl.addEventListener('focusin', (e) => {
        const i = cellIndex(e.target);
        if (i === null || i === focusIdx) return;
        cells[focusIdx].tabIndex = -1;
        cells[i].tabIndex = 0;
        focusIdx = i;
    });

    // Keyboard: arrows move, F flags the focused cell (Enter/Space reveal via click).
    boardEl.addEventListener('keydown', (e) => {
        const i = cellIndex(e.target);
        if (i === null || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'f' || e.key === 'F') {
            if (!over) toggleFlag(i);
            e.stopPropagation(); // keep the page-level F shortcut out of it
            return;
        }
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
        if (!(e.key in moves)) return;
        const x = i % cols;
        if ((e.key === 'ArrowLeft' && x === 0) || (e.key === 'ArrowRight' && x === cols - 1)) return;
        const next = cells[i + moves[e.key]];
        if (next) { e.preventDefault(); next.focus(); }
    });

    // Page-level shortcuts: N or R new game, 1-3 difficulty, F flag mode.
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
        if (e.target.closest('input, textarea, select, [contenteditable]')) return;
        const key = e.key.toLowerCase();
        if (key === 'n' || key === 'r') return newGame();
        if (key === 'f') return setFlagMode(!flagMode);
        if (key === 'm') return setMusic(!audio.music);
        if (key === 'h') return hint();
        const choice = Object.keys(DIFFICULTIES)[Number(key) - 1];
        if (choice) setDifficulty(choice);
    });

    function setDifficulty(key) {
        // Count the abandoned game against the board it was played on.
        if (placed && !over) { recordResult(false); over = true; }
        difficulty = key;
        try { localStorage.setItem('difficulty', difficulty); } catch (e) { /* ignore */ }
        newGame();
    }

    document.querySelectorAll('[data-difficulty]').forEach((b) => {
        b.addEventListener('click', () => setDifficulty(b.dataset.difficulty));
    });
    document.getElementById('new-game').addEventListener('click', newGame);
    flagModeBtn.addEventListener('click', () => setFlagMode(!flagMode));
    hintBtn.addEventListener('click', hint);
    shareBtn.addEventListener('click', share);

    if (audio.supported) {
        musicBtn.setAttribute('aria-pressed', audio.music);
        soundBtn.setAttribute('aria-pressed', audio.sound);
        musicBtn.addEventListener('click', () => setMusic(!audio.music));
        soundBtn.addEventListener('click', () => setSound(!audio.sound));
        // Audio may only start from a user gesture, so begin on the first one.
        for (const type of ['pointerdown', 'keydown']) {
            document.addEventListener(type, audio.unlock, { once: true, capture: true });
        }
    } else {
        musicBtn.hidden = true;
        soundBtn.hidden = true;
    }

    if ('ResizeObserver' in window) {
        new ResizeObserver(fitBoard).observe(boardWrap);
    } else {
        window.addEventListener('resize', fitBoard);
    }

    newGame();
})();
