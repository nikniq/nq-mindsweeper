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
    const logicBtn = document.getElementById('logic');
    const tipEl = document.getElementById('tip');
    const resultDetail = document.getElementById('result-detail');
    const resultShare = document.getElementById('result-share');
    const shareBtn = document.getElementById('share');
    const audio = window.GameAudio;
    const customForm = document.getElementById('custom-form');
    const DAILY = 'daily', CUSTOM = 'custom', DAY = root.dataset.day;

    // A board of the player's own choosing, kept in this browser and never ranked.
    function customBoard(wanted) {
        const whole = (value, min, max, fallback) => {
            const number = Math.round(Number(value));
            return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
        };
        const cols = whole(wanted?.cols, 5, 40, 12), rows = whole(wanted?.rows, 5, 30, 12);
        // Leave room for the clear area around the first click.
        return { label: 'Custom', cols, rows, mines: whole(wanted?.mines, 1, cols * rows - 9, 20) };
    }
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

    DIFFICULTIES[CUSTOM] = customBoard(load(CUSTOM, null));
    try {
        if (localStorage.getItem('difficulty') === CUSTOM) difficulty = CUSTOM;
    } catch (e) { /* storage unavailable */ }

    // Per-difficulty record kept in this browser: played, won, best (ms), streak.
    const stats = load('stats', {}) || {};
    let flagMode = false;

    let cols, rows, mineCount, mines, adjacent, state, cells;
    let placed, over, revealedCount, flagCount, startedAt, tick, focusIdx;
    // startIdx: the cell a daily board must be opened from. ranked: whether
    // this run counts (a daily board only counts the first time it is played).
    let startIdx, ranked, penaltyMs, hintsUsed, clicks, shareText;
    // logicGame: this board is built so it never needs a guess. building: such
    // a board is still being searched for. gameId tells a stale search to stop.
    let logicMode = load('logic', false) === true, logicGame, building, gameId = 0, nbCache;

    const LOGIC_TIP = 'No-guessing board: every move can be worked out from the numbers. These games are not ranked.';

    function previousDay(day) {
        return new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    }

    // Consecutive days on which the daily board was won at the first attempt.
    function dailyStreak() {
        const s = load('dailyStreak', null);
        return s && (s.last === DAY || s.last === previousDay(DAY)) ? s.count : 0;
    }

    function untilNextDaily() {
        const now = new Date();
        const minutes = Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now) / 60000);
        return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    }

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
        if (difficulty === CUSTOM) {
            const board = DIFFICULTIES[CUSTOM];
            statsEl.textContent = `${board.cols}×${board.rows} with ${board.mines} mines. Custom boards are not ranked.`;
            return;
        }
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
        // Replays of the daily board and no-guessing boards say nothing
        // about ordinary play, so they stay out of the record.
        if (!ranked) return false;
        if (difficulty === DAILY) {
            save('daily', { day: DAY, won, ms: won ? ms : null });
            save('dailyStreak', { last: DAY, count: won ? dailyStreak() + 1 : 0 });
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
        building = false;
        gameId++;
        logicGame = logicMode && difficulty !== DAILY;
        clearInterval(tick);

        nbCache = [];
        for (let i = 0; i < n; i++) {
            const x = i % cols, y = (i - x) / cols, out = [];
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) out.push(ny * cols + nx);
                }
            }
            nbCache.push(out);
        }
        logicBtn.disabled = difficulty === DAILY;

        if (difficulty === DAILY) {
            startIdx = Math.floor(seededRandom(DAY + ':start')() * n);
            const played = load('daily', null);
            ranked = !played || played.day !== DAY;
            const streak = dailyStreak();
            const streakText = streak > 0 ? ` Daily streak: ${streak}.` : '';
            setTip(ranked
                ? `Today's board (${DAY}) is the same for everyone. Start on the marked cell. Only your first attempt counts.${streakText}`
                : `You have already played today's board, so this run is practice and is not ranked. Next board in ${untilNextDaily()}.${streakText}`);
        } else if (logicGame) {
            ranked = false;
            setTip(LOGIC_TIP);
        } else {
            ranked = difficulty !== CUSTOM;
            setTip('');
        }
        customForm.hidden = difficulty !== CUSTOM;
        if (difficulty === CUSTOM) {
            for (const field of ['cols', 'rows', 'mines']) customForm.elements[field].value = DIFFICULTIES[CUSTOM][field];
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

    // The returned array is shared; callers must not change it.
    function neighbours(i) {
        return nbCache[i];
    }

    function distance(a, b) {
        const ax = a % cols, bx = b % cols;
        return Math.max(Math.abs(ax - bx), Math.abs((a - ax) / cols - (b - bx) / cols));
    }

    // Mines are laid after the first click so it always opens a clear area.
    function layMines(safe, random) {
        const n = cols * rows, laid = new Uint8Array(n), counts = new Uint8Array(n);
        const banned = new Set([safe, ...neighbours(safe)]);
        const pool = [];
        for (let i = 0; i < n; i++) if (!banned.has(i)) pool.push(i);
        for (let k = 0; k < mineCount; k++) {
            const j = k + Math.floor(random() * (pool.length - k));
            [pool[k], pool[j]] = [pool[j], pool[k]];
            laid[pool[k]] = 1;
        }
        for (let i = 0; i < n; i++) {
            for (const nb of neighbours(i)) counts[i] += laid[nb];
        }
        return { mines: laid, adjacent: counts };
    }

    function begin(layout, first) {
        ({ mines, adjacent } = layout);
        // Opening the daily board uses up the attempt, win or lose.
        if (difficulty === DAILY && ranked) save('daily', { day: DAY, won: false, ms: null });
        cells[first].classList.remove('start');
        placed = true;
        startedAt = performance.now();
        tick = setInterval(() => {
            timerEl.textContent = (elapsed() / 1000).toFixed(1);
        }, 100);
        clicks++;
        reveal(first);
    }

    function firstClick(i) {
        if (!logicGame) {
            return begin(layMines(i, difficulty === DAILY ? seededRandom(DAY + ':mines') : Math.random), i);
        }
        // Keep laying boards until one can be cleared by deduction alone,
        // working in short slices so the page stays responsive.
        building = true;
        setTip('Building a board that needs no guessing…');
        const game = gameId, deadline = performance.now() + 4000;
        (function search() {
            if (game !== gameId) return;
            const until = performance.now() + 25;
            let layout;
            do {
                layout = layMines(i, Math.random);
                if (solvable(layout, i)) {
                    building = false;
                    setTip(LOGIC_TIP);
                    return begin(layout, i);
                }
            } while (performance.now() < until);
            // Very dense custom boards may have no such layout worth waiting for.
            if (performance.now() > deadline) {
                building = false;
                setTip('No board this dense could be found that avoids guessing, so this one may need a guess.');
                return begin(layout, i);
            }
            setTimeout(search, 0);
        })();
    }

    // Marks in `mine` and `safe` every hidden cell whose contents the revealed
    // numbers prove, and returns whether anything new was learnt. Two rules:
    // a number whose remaining mines equal its remaining cells (or zero), and
    // a number whose cells are a subset of another's.
    function deduce(counts, revealed, mine, safe) {
        const n = cols * rows;
        let progress = false;
        for (let changed = true; changed;) {
            changed = false;
            const open = new Array(n);
            for (let i = 0; i < n; i++) {
                if (!revealed[i] || !counts[i]) continue;
                let known = 0;
                const rest = [];
                for (const nb of nbCache[i]) {
                    if (revealed[nb]) continue;
                    if (mine[nb]) known++;
                    else if (!safe[nb]) rest.push(nb);
                }
                if (!rest.length) continue;
                const need = counts[i] - known;
                if (need === rest.length) {
                    for (const c of rest) mine[c] = 1;
                    changed = true;
                } else if (need === 0) {
                    for (const c of rest) safe[c] = 1;
                    changed = true;
                } else {
                    open[i] = { rest, need };
                }
            }
            if (changed) { progress = true; continue; }

            for (let i = 0; i < n; i++) {
                const a = open[i];
                if (!a) continue;
                const x = i % cols, y = (i - x) / cols;
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                        const b = open[ny * cols + nx];
                        if (!b || b.rest.length <= a.rest.length) continue;
                        if (!a.rest.every((c) => b.rest.includes(c))) continue;
                        const extra = b.rest.filter((c) => !a.rest.includes(c) && !mine[c] && !safe[c]);
                        const need = b.need - a.need - b.rest.filter((c) => !a.rest.includes(c) && mine[c]).length;
                        if (!extra.length) continue;
                        if (need === 0) {
                            for (const c of extra) safe[c] = 1;
                            changed = true;
                        } else if (need === extra.length) {
                            for (const c of extra) mine[c] = 1;
                            changed = true;
                        }
                    }
                }
            }
            if (changed) progress = true;
        }
        return progress;
    }

    // Can the board be cleared from `start` using only deduce()?
    function solvable(layout, start) {
        const n = cols * rows, target = n - mineCount;
        const revealed = new Uint8Array(n), mine = new Uint8Array(n);
        let opened = 0;
        const open = (from) => {
            const stack = [from];
            while (stack.length) {
                const i = stack.pop();
                if (revealed[i]) continue;
                revealed[i] = 1;
                opened++;
                if (!layout.adjacent[i]) stack.push(...nbCache[i]);
            }
        };
        open(start);
        while (opened < target) {
            const safe = new Uint8Array(n);
            if (!deduce(layout.adjacent, revealed, mine, safe)) return false;
            let any = false;
            for (let i = 0; i < n; i++) {
                if (safe[i]) { open(i); any = true; }
            }
            if (!any) return false;
        }
        return true;
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
        if (state[i] === REVEALED || building) return;
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
        const practice = !ranked;
        if (practice) {
            summary += difficulty === CUSTOM ? ' Custom board, not ranked.'
                : logicGame ? ' No-guessing board, not ranked.' : ' Practice run, not ranked.';
        }
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
        celebrate();
    }

    // A short burst of confetti over the page.
    function celebrate() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const canvas = document.createElement('canvas');
        canvas.className = 'confetti';
        const w = canvas.width = window.innerWidth, h = canvas.height = window.innerHeight;
        document.body.appendChild(canvas);
        const g = canvas.getContext('2d');
        const colours = ['#7c9cff', '#5fd39a', '#ffb454', '#ff7b7b', '#c792ea', '#5ccfe6'];
        const box = boardEl.getBoundingClientRect();
        const bits = Array.from({ length: 140 }, () => ({
            x: box.left + Math.random() * box.width,
            y: box.top + box.height * 0.4,
            vx: (Math.random() - 0.5) * 14,
            vy: -6 - Math.random() * 10,
            size: 5 + Math.random() * 6,
            spin: Math.random() * 6,
            colour: colours[Math.floor(Math.random() * colours.length)],
        }));
        const began = performance.now(), LIFE = 2600;
        (function frame(now) {
            const age = now - began;
            if (age > LIFE) return canvas.remove();
            g.clearRect(0, 0, w, h);
            g.globalAlpha = Math.min(1, (LIFE - age) / 600);
            for (const bit of bits) {
                bit.vy += 0.35;
                bit.vx *= 0.99;
                bit.x += bit.vx;
                bit.y += bit.vy;
                bit.spin += 0.2;
                g.fillStyle = bit.colour;
                g.fillRect(bit.x, bit.y, bit.size, bit.size * Math.abs(Math.cos(bit.spin)) + 1);
            }
            requestAnimationFrame(frame);
        })(began);
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
        deduce(adjacent, state.map((value) => (value === REVEALED ? 1 : 0)), mine, safe);
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
        if (over || building) return;
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
                const place = data.rank ? ` You are #${data.rank} on ${DIFFICULTIES[difficulty].label}.` : '';
                resultText.textContent = `${summary} Saved to the leaderboard.${place}`;
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

    function setLogicMode(on) {
        if (difficulty === DAILY) return;
        logicMode = on;
        save('logic', on);
        logicBtn.setAttribute('aria-pressed', on);
        // Never throw away a game that is under way.
        if (placed && !over) setTip(`No guessing is ${on ? 'on' : 'off'} from your next game.`);
        else newGame();
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
        if (i === null || over || building) return;
        if (state[i] === REVEALED) return chord(i);
        if (flagMode) return toggleFlag(i);
        if (state[i] === FLAGGED) return;
        if (!placed) {
            if (startIdx !== null && i !== startIdx) {
                mark(startIdx, 'hint', 400);
                return audio.play('deny');
            }
            return firstClick(i);
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
        if (key === 'g') return setLogicMode(!logicMode);
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
    customForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const board = customBoard(Object.fromEntries(new FormData(customForm)));
        DIFFICULTIES[CUSTOM] = board;
        save(CUSTOM, board);
        setDifficulty(CUSTOM);
    });
    flagModeBtn.addEventListener('click', () => setFlagMode(!flagMode));
    hintBtn.addEventListener('click', hint);
    logicBtn.setAttribute('aria-pressed', logicMode);
    logicBtn.addEventListener('click', () => setLogicMode(!logicMode));
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
