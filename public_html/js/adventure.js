// Adventure mode: an endless minefield generated from a seed, explored one
// step at a time by an adventurer with a few hearts to spare.
(() => {
    'use strict';

    const canvas = document.getElementById('world');
    const wrap = canvas.parentElement;
    const g = canvas.getContext('2d');
    const $ = (id) => document.getElementById(id);
    const heartsEl = $('adv-hearts'), goldEl = $('adv-gold'), exploredEl = $('adv-explored');
    const farthestEl = $('adv-farthest'), scoreEl = $('adv-score');
    const arrowEl = $('adv-arrow'), compassText = $('adv-compass-text');
    const statusEl = $('adv-status'), overEl = $('adv-over'), overText = $('adv-over-text');
    const flagBtn = $('adv-flag'), musicBtn = $('music'), soundBtn = $('sound');
    const audio = window.GameAudio;

    const CHUNK = 32;            // cells per side of a stored chunk
    const REGION = 24;           // one shrine per REGION × REGION area
    const START_HEARTS = 3, MAX_HEARTS = 5;
    const FLOOD_CAP = 3000;      // most cells one step may open
    const PATH_CAP = 6000;       // most cells a path search may visit
    const SAVE_KEY = 'adventure', BEST_KEY = 'adventureBest';
    const SCOUT_COST = 40, SCOUT_RADIUS = 2;
    const MINIMAP_CELLS = 128;   // cells across the minimap, one pixel each
    const BIOME_SCALE = 40;      // rough size of a biome, in cells

    // Each biome looks different and shifts the mine density a little.
    const BIOMES = [
        { name: 'Quiet Meadows', tint: '#3a4a60', mod: -0.02 },
        { name: 'Whispering Forest', tint: '#2f4c44', mod: 0 },
        { name: 'Sunken Marsh', tint: '#3d4838', mod: 0.02 },
        { name: 'Frostbound Steppe', tint: '#4b5876', mod: 0.01 },
        { name: 'Ashen Wastes', tint: '#4d3a3c', mod: 0.045 },
    ];

    const MILESTONES = [
        ['explored', 1500, 'Pathfinder: 1,500 cells uncovered'],
        ['explored', 4000, 'Cartographer: 4,000 cells uncovered'],
        ['explored', 10000, 'Surveyor: 10,000 cells uncovered'],
        ['explored', 25000, 'Worldwalker: 25,000 cells uncovered'],
        ['farthest', 50, 'Far from home: 50 cells from camp'],
        ['farthest', 100, 'Wanderer: 100 cells from camp'],
        ['farthest', 200, 'Trailblazer: 200 cells from camp'],
        ['farthest', 400, 'Beyond the maps: 400 cells from camp'],
        ['shrines', 1, 'Pilgrim: your first shrine'],
        ['shrines', 5, 'Devotee: 5 shrines'],
        ['shrines', 12, 'Keeper of shrines: 12 shrines'],
        ['gold', 500, 'Prospector: 500 gold'],
        ['gold', 1500, 'Treasure hunter: 1,500 gold'],
        ['biomes', 5, 'Seen it all: every kind of land'],
    ];
    const HIDDEN = 0, OPEN = 1, FLAG = 2, BLAST = 3, TAKEN = 4; // low two bits: state; TAKEN: pickup collected
    const NUMBER_COLOURS = ['', '#7c9cff', '#5fd39a', '#ff7b7b', '#c792ea', '#ffb454', '#5ccfe6', '#f0f0f0', '#9aa1bd'];
    const DIRECTIONS = {
        arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1],
        arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0],
        q: [-1, -1], e: [1, -1], z: [-1, 1], x: [1, 1],
    };

    const css = getComputedStyle(document.documentElement);
    const colour = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const C = {
        bg: colour('--bg', '#12141c'), cell: colour('--cell', '#3a4163'), open: colour('--cell-open', '#1a1e2d'),
        text: colour('--text', '#e8eaf4'), bad: colour('--bad', '#ff6b6b'), flag: colour('--flag', '#ffb454'),
        accent: colour('--accent', '#7c9cff'), good: colour('--good', '#5fd39a'), muted: colour('--muted', '#9aa1bd'),
    };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let world, shrineCache, mineCache, best = 0;
    const minimap = document.getElementById('adv-minimap');
    const mini = minimap.getContext('2d');
    const toastEl = document.getElementById('adv-toast');
    const biomeEl = document.getElementById('adv-biome');
    const scoutBtn = document.getElementById('adv-scout');
    let toastQueue = [], toastTimer = null;
    let size = 30;                               // cell size in CSS pixels
    const cam = { x: 0, y: 0, free: false };     // view centre, in cells
    let dirty = true, walkQueue = [], walkTimer = null, flagMode = false, shakeUntil = 0, saveTimer = null;

    // ---- World generation ------------------------------------------------

    function hash(x, y, salt) {
        let h = Math.imul(world.seed ^ Math.imul(salt + 1, 0x9e3779b9), 0x85ebca6b);
        h ^= Math.imul(x | 0, 0x27d4eb2f);
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        h ^= Math.imul(y | 0, 0x165667b1);
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    const distanceFromCamp = (x, y) => Math.max(Math.abs(x), Math.abs(y));
    const regionOf = (n) => Math.floor(n / REGION);

    function shrineIn(rx, ry) {
        if (rx === 0 && ry === 0) return null; // camp is in region 0, 0
        const key = rx + ',' + ry;
        let shrine = shrineCache.get(key);
        if (shrine === undefined) {
            shrine = {
                key,
                x: rx * REGION + 4 + Math.floor(hash(rx, ry, 11) * (REGION - 8)),
                y: ry * REGION + 4 + Math.floor(hash(rx, ry, 12) * (REGION - 8)),
            };
            shrineCache.set(key, shrine);
        }
        return shrine;
    }

    const smooth = (t) => t * t * (3 - 2 * t);

    // Smooth value noise on a coarse grid, so biomes form large blobs.
    function noise(x, y) {
        const gx = Math.floor(x / BIOME_SCALE), gy = Math.floor(y / BIOME_SCALE);
        const fx = smooth(x / BIOME_SCALE - gx), fy = smooth(y / BIOME_SCALE - gy);
        const top = hash(gx, gy, 21) * (1 - fx) + hash(gx + 1, gy, 21) * fx;
        const bottom = hash(gx, gy + 1, 21) * (1 - fx) + hash(gx + 1, gy + 1, 21) * fx;
        return top * (1 - fy) + bottom * fy;
    }

    function biomeAt(x, y) {
        if (distanceFromCamp(x, y) < 16) return BIOMES[0];
        const n = noise(x, y);
        return BIOMES[n < 0.3 ? 0 : n < 0.5 ? 1 : n < 0.65 ? 2 : n < 0.8 ? 3 : 4];
    }

    // Whether a cell holds a mine, worked out once per cell and remembered.
    function isMine(x, y) {
        const key = Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK);
        let known = mineCache.get(key);
        if (!known) mineCache.set(key, (known = new Uint8Array(CHUNK * CHUNK)));
        const at = offset(x, y);
        if (!known[at]) known[at] = rollMine(x, y) ? 2 : 1;
        return known[at] === 2;
    }

    // Camp and the ground around each shrine are always safe. Worlds made
    // before biomes existed (gen 1) keep their original layout.
    function rollMine(x, y) {
        const d = distanceFromCamp(x, y);
        if (d <= 1) return false;
        const shrine = shrineIn(regionOf(x), regionOf(y));
        if (shrine && Math.abs(shrine.x - x) <= 1 && Math.abs(shrine.y - y) <= 1) return false;
        const biome = world.gen >= 2 ? biomeAt(x, y).mod : 0;
        return hash(x, y, 1) < Math.min(0.23, 0.12 + d * 0.0006) + biome;
    }

    function adjacent(x, y) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && isMine(x + dx, y + dy)) n++;
        }
        return n;
    }

    function pickupAt(x, y) {
        const shrine = shrineIn(regionOf(x), regionOf(y));
        if (shrine && shrine.x === x && shrine.y === y) return 'shrine';
        if (distanceFromCamp(x, y) <= 2 || isMine(x, y)) return null;
        const roll = hash(x, y, 2);
        const chests = world.gen >= 2 ? 0.017 : 0.011;
        return roll < chests ? 'gold' : roll < chests + 0.004 ? 'heart' : null;
    }

    // ---- Stored cell state, in chunks -------------------------------------

    function chunk(x, y, create) {
        const key = Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK);
        let cells = world.chunks.get(key);
        if (!cells && create) world.chunks.set(key, (cells = new Uint8Array(CHUNK * CHUNK)));
        return cells;
    }
    const offset = (x, y) => (((y % CHUNK) + CHUNK) % CHUNK) * CHUNK + (((x % CHUNK) + CHUNK) % CHUNK);
    const cellAt = (x, y) => { const cells = chunk(x, y, false); return cells ? cells[offset(x, y)] : HIDDEN; };
    const stateAt = (x, y) => cellAt(x, y) & 3;
    const putCell = (x, y, value) => { chunk(x, y, true)[offset(x, y)] = value; };
    const setState = (x, y, state) => putCell(x, y, (cellAt(x, y) & ~3) | state);

    // ---- Saving -------------------------------------------------------------

    function newWorld() {
        world = {
            seed: (Math.random() * 4294967296) >>> 0,
            gen: 2, px: 0, py: 0, hearts: START_HEARTS, gold: 0, explored: 0, farthest: 0, over: false,
            shrines: new Set(), chunks: new Map(), milestones: [], biomesSeen: [BIOMES[0].name],
        };
        shrineCache = new Map();
        mineCache = new Map();
        open(0, 0);
        cam.x = 0; cam.y = 0; cam.free = false;
    }

    function load() {
        try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { best = 0; }
        try {
            const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
            if (!saved || saved.v !== 1) return false;
            const chunks = new Map();
            for (const [key, data] of Object.entries(saved.chunks)) {
                chunks.set(key, Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)));
            }
            world = { gen: 1, biomesSeen: [], ...saved, shrines: new Set(saved.shrines), chunks };
            shrineCache = new Map();
            mineCache = new Map();
            if (!world.milestones) {
                // Saved before milestones existed: count what was already done, quietly.
                world.milestones = [];
                checkMilestones(true);
            }
            cam.x = world.px; cam.y = world.py;
            return true;
        } catch (e) {
            return false;
        }
    }

    function save() {
        clearTimeout(saveTimer);
        saveTimer = null;
        try {
            const chunks = {};
            for (const [key, cells] of world.chunks) chunks[key] = btoa(String.fromCharCode.apply(null, cells));
            localStorage.setItem(SAVE_KEY, JSON.stringify({ ...world, v: 1, shrines: [...world.shrines], chunks }));
        } catch (e) { /* storage full or unavailable: the journey just won't survive a reload */ }
    }
    const saveSoon = () => { if (!saveTimer) saveTimer = setTimeout(save, 500); };

    // ---- Play -------------------------------------------------------------

    const score = () => world.gold + world.explored + world.farthest * 5;

    function say(text) { statusEl.textContent = text; }

    // Uncover a cell, spreading across empty ground. Returns how many opened.
    function open(x, y) {
        const stack = [[x, y]];
        let opened = 0;
        while (stack.length && opened < FLOOD_CAP) {
            const [cx, cy] = stack.pop();
            if (stateAt(cx, cy) !== HIDDEN) continue;
            setState(cx, cy, OPEN);
            opened++;
            world.explored++;
            world.farthest = Math.max(world.farthest, distanceFromCamp(cx, cy));
            if (adjacent(cx, cy) === 0) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) if (dx || dy) stack.push([cx + dx, cy + dy]);
                }
            }
        }
        return opened;
    }

    // Move one cell. Returns whether the adventurer actually moved.
    function step(x, y) {
        if (world.over) return false;
        const state = stateAt(x, y);
        if (state === FLAG) { audio.play('deny'); say('There is a flag there. Remove it first to step on that cell.'); return false; }
        if (state === BLAST) { audio.play('deny'); say('That crater is impassable.'); return false; }

        if (state === HIDDEN) {
            if (isMine(x, y)) return explode(x, y);
            const opened = open(x, y);
            audio.play(opened > 1 ? 'flood' : 'reveal', adjacent(x, y));
        }
        world.px = x;
        world.py = y;
        cam.free = false;
        enterBiome(x, y);
        collect(x, y);
        changed();
        return true;
    }

    function explode(x, y) {
        setState(x, y, BLAST);
        world.hearts--;
        audio.play('lose');
        shakeUntil = performance.now() + 350;
        stopWalking();
        if (world.hearts <= 0) {
            world.over = true;
            say('The last heart is gone.');
            finish();
        } else {
            say(`Boom! A mine. ${world.hearts} ${world.hearts === 1 ? 'heart' : 'hearts'} left.`);
        }
        changed();
        return false;
    }

    function collect(x, y) {
        const value = cellAt(x, y);
        if (value & TAKEN) return;
        const kind = pickupAt(x, y);
        if (!kind) return;
        putCell(x, y, value | TAKEN);
        if (kind === 'gold') {
            const found = 10 + Math.floor(hash(x, y, 3) * 31);
            world.gold += found;
            audio.play('reveal', 8);
            say(`A chest! +${found} gold.`);
        } else if (kind === 'heart') {
            if (world.hearts < MAX_HEARTS) {
                world.hearts++;
                say('You found a heart.');
            } else {
                world.gold += 25;
                say('A heart, but yours are full. +25 gold instead.');
            }
            audio.play('flag');
        } else {
            const shrine = shrineIn(regionOf(x), regionOf(y));
            world.shrines.add(shrine.key);
            world.gold += 100;
            world.hearts = Math.min(MAX_HEARTS, world.hearts + 1);
            audio.play('win');
            say(`You reached a shrine (${world.shrines.size} so far). +100 gold and a heart.`);
        }
    }

    function toggleFlag(x, y) {
        if (world.over) return;
        const state = stateAt(x, y);
        if (state !== HIDDEN && state !== FLAG) return;
        setState(x, y, state === FLAG ? HIDDEN : FLAG);
        audio.play(state === FLAG ? 'unflag' : 'flag');
        changed();
    }

    function finish() {
        const final = score();
        const isBest = final > best;
        if (isBest) {
            best = final;
            try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
        }
        overText.textContent = `You uncovered ${world.explored} cells, travelled ${world.farthest} from camp, `
            + `reached ${world.shrines.size} ${world.shrines.size === 1 ? 'shrine' : 'shrines'} and gathered ${world.gold} gold. `
            + `Score ${final}${isBest ? ', a new best!' : ` (best ${best}).`}`;
        overEl.hidden = false;
    }

    function changed() {
        dirty = true;
        checkMilestones(false);
        renderHud();
        drawMinimap();
        saveSoon();
    }

    let currentBiome = null;

    function enterBiome(x, y) {
        const biome = biomeAt(x, y);
        if (biome === currentBiome) return;
        const first = currentBiome !== null && !world.biomesSeen.includes(biome.name);
        currentBiome = biome;
        if (!world.biomesSeen.includes(biome.name)) world.biomesSeen.push(biome.name);
        if (first) toast(`You discover the ${biome.name}.${biome.mod > 0.03 ? ' Mines lie thick here.' : ''}`);
    }

    function checkMilestones(quiet) {
        const reached = {
            explored: world.explored, farthest: world.farthest, shrines: world.shrines.size,
            gold: world.gold, biomes: world.biomesSeen.length,
        };
        for (const [stat, target, text] of MILESTONES) {
            const id = stat + ':' + target;
            if (reached[stat] < target || world.milestones.includes(id)) continue;
            world.milestones.push(id);
            if (!quiet) toast('🏅 ' + text);
        }
    }

    function toast(text) {
        // Keep up with fast walking: never hold more than a couple waiting.
        if (toastQueue.length >= 2) toastQueue.shift();
        toastQueue.push(text);
        if (!toastTimer) nextToast();
    }

    function nextToast() {
        const text = toastQueue.shift();
        if (text === undefined) {
            toastEl.hidden = true;
            toastTimer = null;
            return;
        }
        toastEl.textContent = text;
        toastEl.hidden = false;
        toastEl.classList.remove('show');
        void toastEl.offsetWidth; // restart the animation
        toastEl.classList.add('show');
        toastTimer = setTimeout(nextToast, 2600);
    }

    // Pay gold to have every mine close by marked with a flag.
    function scout() {
        if (world.over) return;
        if (world.gold < SCOUT_COST) {
            audio.play('deny');
            say(`Scouting costs ${SCOUT_COST} gold and you have ${world.gold}. Find chests and shrines first.`);
            return;
        }
        let marked = 0;
        for (let dy = -SCOUT_RADIUS; dy <= SCOUT_RADIUS; dy++) {
            for (let dx = -SCOUT_RADIUS; dx <= SCOUT_RADIUS; dx++) {
                const x = world.px + dx, y = world.py + dy;
                if (stateAt(x, y) === HIDDEN && isMine(x, y)) {
                    setState(x, y, FLAG);
                    marked++;
                }
            }
        }
        if (!marked) {
            say('Your scout finds no unmarked mines within two cells, so no gold was spent.');
            return;
        }
        world.gold -= SCOUT_COST;
        audio.play('flag');
        say(`Your scout marks ${marked} ${marked === 1 ? 'mine' : 'mines'} nearby. −${SCOUT_COST} gold.`);
        changed();
    }

    // A small overview of the land around the adventurer.
    function drawMinimap() {
        const n = MINIMAP_CELLS, half = n / 2;
        const image = mini.createImageData(n, n);
        const px = image.data;
        const paint = (i, r, gr, b, a) => { px[i] = r; px[i + 1] = gr; px[i + 2] = b; px[i + 3] = a; };
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const state = stateAt(world.px - half + x, world.py - half + y), i = (y * n + x) * 4;
                if (state === OPEN) paint(i, 120, 132, 186, 255);
                else if (state === FLAG) paint(i, 255, 180, 84, 255);
                else if (state === BLAST) paint(i, 255, 107, 107, 255);
                else paint(i, 18, 20, 28, 170);
            }
        }
        mini.putImageData(image, 0, 0);

        const dot = (x, y, fill, r) => {
            mini.fillStyle = fill;
            mini.fillRect(x - world.px + half - r, y - world.py + half - r, r * 2 + 1, r * 2 + 1);
        };
        const rx0 = regionOf(world.px), ry0 = regionOf(world.py), reach = Math.ceil(half / REGION) + 1;
        for (let ry = ry0 - reach; ry <= ry0 + reach; ry++) {
            for (let rx = rx0 - reach; rx <= rx0 + reach; rx++) {
                const shrine = shrineIn(rx, ry);
                if (shrine) dot(shrine.x, shrine.y, world.shrines.has(shrine.key) ? '#9aa1bd' : '#f6c945', 1);
            }
        }
        if (Math.abs(world.px) < half && Math.abs(world.py) < half) dot(0, 0, '#5fd39a', 1);
        dot(world.px, world.py, '#ffffff', 1);
    }

    // ---- Walking further than one cell --------------------------------------

    // Shortest route over uncovered ground to (tx, ty), or to a cell beside it
    // when it is still hidden. Returns the steps to take, or null.
    function route(tx, ty) {
        const goalHidden = stateAt(tx, ty) !== OPEN;
        const start = world.px + ',' + world.py;
        const previous = new Map([[start, null]]);
        const queue = [[world.px, world.py]];
        for (let head = 0; head < queue.length && previous.size < PATH_CAP; head++) {
            const [x, y] = queue[head];
            const arrived = goalHidden
                ? Math.max(Math.abs(x - tx), Math.abs(y - ty)) === 1
                : x === tx && y === ty;
            if (arrived) {
                const steps = goalHidden ? [[tx, ty]] : [];
                for (let key = x + ',' + y; key !== start; key = previous.get(key)) {
                    steps.unshift(key.split(',').map(Number));
                }
                return steps;
            }
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy, key = nx + ',' + ny;
                    if ((!dx && !dy) || previous.has(key) || stateAt(nx, ny) !== OPEN) continue;
                    previous.set(key, x + ',' + y);
                    queue.push([nx, ny]);
                }
            }
        }
        return null;
    }

    function stopWalking() {
        walkQueue = [];
        clearInterval(walkTimer);
        walkTimer = null;
    }

    function walk(steps) {
        stopWalking();
        walkQueue = steps;
        const next = () => {
            const target = walkQueue.shift();
            if (!target || !step(target[0], target[1]) || !walkQueue.length) stopWalking();
        };
        next();
        if (walkQueue.length) walkTimer = setInterval(next, reducedMotion ? 30 : 75);
    }

    function goTo(x, y) {
        if (world.over || (x === world.px && y === world.py)) return;
        if (Math.max(Math.abs(x - world.px), Math.abs(y - world.py)) === 1) {
            stopWalking();
            step(x, y);
            return;
        }
        if (stateAt(x, y) === FLAG || stateAt(x, y) === BLAST) { audio.play('deny'); return; }
        const steps = route(x, y);
        if (steps) walk(steps);
        else { audio.play('deny'); say('No known way there yet. Uncover a path first.'); }
    }

    // ---- Drawing --------------------------------------------------------

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(canvas.clientWidth * dpr);
        canvas.height = Math.round(canvas.clientHeight * dpr);
        dirty = true;
    }

    function nearestShrine() {
        const rx0 = regionOf(world.px), ry0 = regionOf(world.py);
        let found = null, foundDistance = Infinity;
        for (let r = 0; r <= 4 && !found; r++) {
            for (let ry = ry0 - r; ry <= ry0 + r; ry++) {
                for (let rx = rx0 - r; rx <= rx0 + r; rx++) {
                    if (Math.max(Math.abs(rx - rx0), Math.abs(ry - ry0)) !== r) continue;
                    const shrine = shrineIn(rx, ry);
                    if (!shrine || world.shrines.has(shrine.key)) continue;
                    const d = Math.hypot(shrine.x - world.px, shrine.y - world.py);
                    if (d < foundDistance) { found = shrine; foundDistance = d; }
                }
            }
        }
        return found;
    }

    function renderHud() {
        heartsEl.textContent = '♥'.repeat(Math.max(0, world.hearts)) + '♡'.repeat(Math.max(0, MAX_HEARTS - world.hearts));
        heartsEl.setAttribute('aria-label', `${world.hearts} of ${MAX_HEARTS}`);
        goldEl.textContent = world.gold;
        biomeEl.textContent = biomeAt(world.px, world.py).name;
        scoutBtn.disabled = world.over || world.gold < SCOUT_COST;
        exploredEl.textContent = world.explored;
        farthestEl.textContent = world.farthest;
        const current = score();
        scoreEl.textContent = current;
        scoreEl.title = `Best ${Math.max(best, current)}`;

        const shrine = nearestShrine();
        if (shrine) {
            const dx = shrine.x - world.px, dy = shrine.y - world.py;
            const names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
            const angle = Math.atan2(dy, dx);
            arrowEl.style.transform = `rotate(${angle}rad)`;
            compassText.textContent = `Nearest shrine: ${Math.max(Math.abs(dx), Math.abs(dy))} cells ${names[(Math.round(angle / (Math.PI / 4)) + 8) % 8]}.`;
        }
    }

    function draw(now) {
        const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
        const shake = now < shakeUntil && !reducedMotion ? (Math.random() - 0.5) * 8 : 0;
        g.setTransform(dpr, 0, 0, dpr, shake, 0);
        g.fillStyle = C.bg;
        g.fillRect(-10, 0, w + 20, h);

        const halfW = w / 2 / size, halfH = h / 2 / size;
        const x0 = Math.floor(cam.x - halfW) - 1, x1 = Math.ceil(cam.x + halfW) + 1;
        const y0 = Math.floor(cam.y - halfH) - 1, y1 = Math.ceil(cam.y + halfH) + 1;
        const screenX = (x) => (x - cam.x) * size + w / 2 - size / 2;
        const screenY = (y) => (y - cam.y) * size + h / 2 - size / 2;
        const inner = Math.max(1, size - 2);
        const font = `700 ${Math.round(size * 0.52)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = font;

        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const sx = screenX(x), sy = screenY(y), cx = sx + size / 2, cy = sy + size / 2 + 1;
                const value = cellAt(x, y), state = value & 3;
                const pickup = state === OPEN || state === HIDDEN ? pickupAt(x, y) : null;

                if (state === OPEN) {
                    g.fillStyle = C.open;
                    g.fillRect(sx + 1, sy + 1, inner, inner);
                    if (pickup && !(value & TAKEN)) {
                        drawPickup(pickup, cx, cy, x, y);
                    } else if (pickup === 'shrine') {
                        drawPickup(pickup, cx, cy, x, y);
                    } else {
                        const n = adjacent(x, y);
                        if (n) {
                            g.fillStyle = NUMBER_COLOURS[n];
                            g.fillText(n, cx, cy);
                        }
                    }
                } else if (state === BLAST) {
                    g.fillStyle = C.bad;
                    g.fillRect(sx + 1, sy + 1, inner, inner);
                    g.fillStyle = '#2a0b0b';
                    g.fillText('✹', cx, cy);
                } else {
                    // Unexplored ground, with a little texture so it reads as terrain.
                    const shade = hash(x, y, 5);
                    g.fillStyle = biomeAt(x, y).tint;
                    g.globalAlpha = 0.78 + shade * 0.22;
                    g.fillRect(sx + 1, sy + 1, inner, inner);
                    g.globalAlpha = 1;
                    if (state === FLAG) {
                        g.fillStyle = C.flag;
                        g.fillText('⚑', cx, cy);
                    } else if (pickup === 'shrine') {
                        // Shrines are landmarks: they show through the fog.
                        g.globalAlpha = 0.65;
                        drawPickup('shrine', cx, cy, x, y);
                        g.globalAlpha = 1;
                    }
                }
            }
        }

        // The adventurer, with a lantern that lights the ground nearby.
        const px = (world.px - cam.x) * size + w / 2, py = (world.py - cam.y) * size + h / 2;
        const light = g.createRadialGradient(px, py, size * 4, px, py, size * 14);
        light.addColorStop(0, 'rgba(10, 12, 20, 0)');
        light.addColorStop(1, 'rgba(10, 12, 20, 0.55)');
        g.fillStyle = light;
        g.fillRect(-10, 0, w + 20, h);

        const glow = g.createRadialGradient(px, py, 0, px, py, size * 1.4);
        glow.addColorStop(0, 'rgba(255, 214, 120, 0.45)');
        glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
        g.fillStyle = glow;
        g.fillRect(px - size * 1.5, py - size * 1.5, size * 3, size * 3);

        g.fillStyle = world.over ? C.muted : '#ffd678';
        g.beginPath();
        g.arc(px, py, size * 0.34, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#141a5c';
        g.lineWidth = Math.max(1.5, size * 0.08);
        g.stroke();
        g.fillStyle = '#141a5c';
        g.beginPath();
        g.arc(px - size * 0.1, py - size * 0.05, size * 0.05, 0, Math.PI * 2);
        g.arc(px + size * 0.1, py - size * 0.05, size * 0.05, 0, Math.PI * 2);
        g.fill();
    }

    function drawPickup(kind, cx, cy, x, y) {
        if (kind === 'shrine') {
            const visited = world.shrines.has(shrineIn(regionOf(x), regionOf(y)).key);
            const r = size * 0.36;
            g.fillStyle = visited ? C.muted : '#f6c945';
            g.beginPath();
            g.moveTo(cx, cy - r);
            g.lineTo(cx + r * 0.8, cy);
            g.lineTo(cx, cy + r);
            g.lineTo(cx - r * 0.8, cy);
            g.closePath();
            g.fill();
            g.fillStyle = '#141a5c';
            g.fillText('✦', cx, cy);
        } else if (kind === 'gold') {
            g.fillStyle = '#f6c945';
            g.fillText('◆', cx, cy);
        } else {
            g.fillStyle = C.bad;
            g.fillText('♥', cx, cy);
        }
    }

    function frame(now) {
        // Ease the view towards the adventurer unless the player is looking around.
        if (!cam.free) {
            const dx = world.px - cam.x, dy = world.py - cam.y;
            if (Math.abs(dx) + Math.abs(dy) > 0.002) {
                const ease = reducedMotion ? 1 : 0.2;
                cam.x += dx * ease;
                cam.y += dy * ease;
                dirty = true;
            }
        }
        if (now < shakeUntil) dirty = true;
        if (dirty) {
            dirty = false;
            draw(now);
        }
        requestAnimationFrame(frame);
    }

    // ---- Input ----------------------------------------------------------

    function cellAtPointer(e) {
        const rect = canvas.getBoundingClientRect();
        return [
            Math.round((e.clientX - rect.left - rect.width / 2) / size + cam.x),
            Math.round((e.clientY - rect.top - rect.height / 2) / size + cam.y),
        ];
    }

    let press = null;

    canvas.addEventListener('pointerdown', (e) => {
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(e.pointerId);
        press = { x: e.clientX, y: e.clientY, button: e.button, panned: false, flagged: false, timer: null };
        if (e.pointerType !== 'mouse') {
            press.timer = setTimeout(() => {
                press.flagged = true;
                const [x, y] = cellAtPointer(e);
                toggleFlag(x, y);
                if (navigator.vibrate) navigator.vibrate(15);
            }, 400);
        }
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!press) return;
        const dx = e.clientX - press.x, dy = e.clientY - press.y;
        if (!press.panned && Math.abs(dx) + Math.abs(dy) < 8) return;
        clearTimeout(press.timer);
        press.panned = true;
        cam.free = true;
        cam.x -= dx / size;
        cam.y -= dy / size;
        press.x = e.clientX;
        press.y = e.clientY;
        dirty = true;
    });

    canvas.addEventListener('pointerup', (e) => {
        if (!press) return;
        clearTimeout(press.timer);
        const done = press;
        press = null;
        if (done.panned || done.flagged) return;
        const [x, y] = cellAtPointer(e);
        if (done.button === 2 || flagMode) toggleFlag(x, y);
        else if (done.button === 0) goTo(x, y);
    });
    canvas.addEventListener('pointercancel', () => { if (press) clearTimeout(press.timer); press = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    function zoom(factor) {
        size = Math.max(14, Math.min(56, Math.round(size * factor)));
        dirty = true;
    }

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    function centre() {
        cam.free = false;
        dirty = true;
    }

    function setFlagMode(on) {
        flagMode = on;
        flagBtn.setAttribute('aria-pressed', on);
    }

    function restart() {
        if (!world.over && world.explored > 20 && !window.confirm('Leave this world and start a new journey?')) return;
        stopWalking();
        newWorld();
        overEl.hidden = true;
        say('A new world. Your camp is safe; the rest is up to you.');
        changed();
        save();
        canvas.focus({ preventScroll: true });
    }

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
        const key = e.key.toLowerCase();
        const direction = DIRECTIONS[key];
        if (direction) {
            e.preventDefault();
            const x = world.px + direction[0], y = world.py + direction[1];
            if (e.shiftKey) toggleFlag(x, y);
            else { stopWalking(); step(x, y); }
            return;
        }
        if (e.repeat) return;
        if (key === 'f') setFlagMode(!flagMode);
        else if (key === 'c') centre();
        else if (key === 'r') scout();
        else if (key === 'n') restart();
        else if (key === '+' || key === '=') zoom(1.15);
        else if (key === '-' || key === '_') zoom(1 / 1.15);
        else if (key === 'm' && audio.supported) setMusic(!audio.music);
    });

    function setMusic(on) {
        audio.setMusic(on);
        musicBtn.setAttribute('aria-pressed', audio.music);
    }

    flagBtn.addEventListener('click', () => setFlagMode(!flagMode));
    $('adv-center').addEventListener('click', centre);
    scoutBtn.addEventListener('click', scout);
    $('adv-new').addEventListener('click', restart);
    $('adv-restart').addEventListener('click', restart);

    if (audio.supported) {
        musicBtn.setAttribute('aria-pressed', audio.music);
        soundBtn.setAttribute('aria-pressed', audio.sound);
        musicBtn.addEventListener('click', () => setMusic(!audio.music));
        soundBtn.addEventListener('click', () => {
            audio.setSound(!audio.sound);
            soundBtn.setAttribute('aria-pressed', audio.sound);
        });
        for (const type of ['pointerdown', 'keydown']) {
            document.addEventListener(type, audio.unlock, { once: true, capture: true });
        }
    } else {
        musicBtn.hidden = true;
        soundBtn.hidden = true;
    }

    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(wrap);
    else window.addEventListener('resize', resize);

    const resumed = load();
    if (!resumed) newWorld();
    resize();
    currentBiome = biomeAt(world.px, world.py);
    renderHud();
    drawMinimap();
    if (world.over) finish();
    else say(resumed ? 'Welcome back. Your journey continues where you left it.' : 'You set out from camp. Walk onto hidden cells to explore; the numbers warn of mines.');
    requestAnimationFrame(frame);

    // Exposed for automated checks only.
    window.__adventure = { get world() { return world; }, isMine, stateAt, shrineIn, route };
})();
