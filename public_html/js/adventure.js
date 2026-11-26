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
        { name: 'Quiet Meadows', tint: '#3a4a60', mod: -0.02, detail: 'grass' },
        { name: 'Whispering Forest', tint: '#2f4c44', mod: 0, detail: 'tree' },
        { name: 'Sunken Marsh', tint: '#3d4838', mod: 0.02, detail: 'reed' },
        { name: 'Frostbound Steppe', tint: '#4b5876', mod: 0.01, detail: 'snow' },
        { name: 'Ashen Wastes', tint: '#4d3a3c', mod: 0.045, detail: 'ember' },
    ];
    BIOMES.forEach((biome, id) => { biome.id = id; });

    // Every map is a place with its own name and character.
    const PLACE_NAMES = [
        'Ellwyn', 'Thornmere', 'Corrow', 'Saltmarsh', 'Duskhollow', 'Ravensgate', 'Aldmoor', 'Brackenford',
        'Wyrmrest', 'Cindervale', 'Mirelow', 'Starfall', 'Gloamwood', 'Ironholt', 'Hollowmere', 'Ashbourne',
    ];
    const PLACE_KINDS = [
        { kind: 'Vale', line: 'A green valley where old shrines hide among the grass.' },
        { kind: 'Moor', line: 'Wind-scoured moorland. The shrines stand like waymarkers.' },
        { kind: 'Fen', line: 'Low, wet country where the ground hides its teeth. Step softly.' },
        { kind: 'Barrows', line: 'Ancient burial mounds. Something sleeps beneath the turf.' },
        { kind: 'Reach', line: 'A long stretch of wild country at the edge of every map.' },
        { kind: 'Hollows', line: 'Sunken ground riddled with old workings and forgotten traps.' },
        { kind: 'Highlands', line: 'Cold heights where the wind howls through the gate.' },
        { kind: 'Wastes', line: 'Scorched land, sown thick with mines by some old war.' },
    ];
    const MAX_PLACE_SHRINES = 16;

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
        ['places', 1, 'Gatecrosser: through your first gate'],
        ['places', 3, 'Wayfarer: three places behind you'],
        ['places', 7, 'Legend of the roads: seven places behind you'],
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

    let world, shrineCache, mineCache, placeCache, best = 0;
    const minimap = document.getElementById('adv-minimap');
    const mini = minimap.getContext('2d');
    const toastEl = document.getElementById('adv-toast');
    const biomeEl = document.getElementById('adv-biome');
    const placeEl = document.getElementById('adv-place');
    const placeLevelEl = document.getElementById('adv-place-level');
    const placeLineEl = document.getElementById('adv-place-line');
    const compassEl = document.getElementById('adv-compass');
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

    // The place this map is: its name, its shrines and its gate. Shrines sit
    // in the regions next to camp, more of them in later places; the gate is
    // the clearing of a region one ring further out.
    function place() {
        if (placeCache) return placeCache;
        const ring = (r) => {
            const out = [];
            for (let ry = -r; ry <= r; ry++) {
                for (let rx = -r; rx <= r; rx++) if (Math.max(Math.abs(rx), Math.abs(ry)) === r) out.push([rx, ry]);
            }
            return out;
        };
        const shuffled = (list, salt) => list
            .map((r) => [hash(r[0], r[1], salt), r])
            .sort((a, b) => a[0] - b[0])
            .map((pair) => pair[1]);
        const inner = shuffled(ring(1), 41), outer = shuffled(ring(2), 42);
        const count = Math.min(MAX_PLACE_SHRINES, 4 + 2 * (world.level - 1));
        const shrines = [...inner, ...outer].slice(0, count).map(([rx, ry]) => shrineIn(rx, ry));
        const [gx, gy] = outer[outer.length - 1];
        const gate = shrineIn(gx, gy);
        const kind = PLACE_KINDS[Math.floor(hash(0, 0, 32) * PLACE_KINDS.length)];
        // Don't send the traveller somewhere whose name they have already passed through.
        const first = Math.floor(hash(0, 0, 31) * PLACE_NAMES.length);
        let name = PLACE_NAMES[first];
        for (let k = 0; k < PLACE_NAMES.length; k++) {
            name = PLACE_NAMES[(first + k) % PLACE_NAMES.length];
            if (!world.places.some((visited) => visited.startsWith(name + ' '))) break;
        }
        placeCache = {
            name: name + ' ' + kind.kind,
            line: kind.line,
            shrines,
            keys: new Set(shrines.map((s) => s.key)),
            gate: { x: gate.x, y: gate.y },
        };
        return placeCache;
    }

    const shrinesLeft = () => place().shrines.filter((s) => !world.shrines.has(s.key));
    const gateOpen = () => shrinesLeft().length === 0;

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
        const deeper = world.gen >= 3 ? Math.min(0.05, (world.level - 1) * 0.01) : 0; // later places are harsher
        return hash(x, y, 1) < Math.min(0.23, 0.12 + d * 0.0006) + biome + deeper;
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
        if (shrine && shrine.x === x && shrine.y === y) {
            // Other regions keep their clearing, but only this place's shrines are shrines.
            if (place().keys.has(shrine.key)) return 'shrine';
            if (place().gate.x === x && place().gate.y === y) return 'gate';
            return null;
        }
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
            gen: 3, level: 1, px: 0, py: 0, hearts: START_HEARTS, gold: 0, explored: 0, farthest: 0, over: false,
            bonus: 0, places: [], shrines: new Set(), chunks: new Map(), milestones: [], biomesSeen: [BIOMES[0].name],
        };
        arrive();
    }

    // Set out from camp in the place the current seed describes.
    function arrive() {
        shrineCache = new Map();
        mineCache = new Map();
        placeCache = null;
        world.px = 0;
        world.py = 0;
        world.farthest = 0;
        world.shrines = new Set();
        world.chunks = new Map();
        reveals.clear();
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
            world = {
                gen: 1, level: 1, bonus: 0, places: [], biomesSeen: [],
                ...saved, shrines: new Set(saved.shrines), chunks,
            };
            shrineCache = new Map();
            mineCache = new Map();
            placeCache = null;
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

    // Each place left behind banks its distance and a bonus.
    const score = () => world.gold + world.explored + world.farthest * 5 + world.bonus;

    function say(text) { statusEl.textContent = text; }

    // Uncover a cell, spreading across empty ground. Returns how many opened.
    function open(x, y) {
        const stack = [[x, y]];
        let opened = 0;
        while (stack.length && opened < FLOOD_CAP) {
            const [cx, cy] = stack.pop();
            if (stateAt(cx, cy) !== HIDDEN) continue;
            setState(cx, cy, OPEN);
            if (!reducedMotion && opened < 1500) {
                reveals.set(cx + ',' + cy, { t: performance.now(), delay: Math.min(Math.max(Math.abs(cx - x), Math.abs(cy - y)) * 18, 360) });
            }
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
        if (pickupAt(x, y) === 'gate') return useGate();
        changed();
        return true;
    }

    function explode(x, y) {
        setState(x, y, BLAST);
        if (!reducedMotion) blastFx = { x, y, t: performance.now() };
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
        if (!kind || kind === 'gate') return;
        putCell(x, y, value | TAKEN);
        if (kind === 'gold') {
            const found = 10 + Math.floor(hash(x, y, 3) * 31);
            world.gold += found;
            audio.play('coins');
            floatText(x, y, `+${found}`, '#ffd34d');
            say(`A chest! +${found} gold.`);
        } else if (kind === 'heart') {
            if (world.hearts < MAX_HEARTS) {
                world.hearts++;
                floatText(x, y, '+♥', '#ff6b81');
                say('You found a heart.');
            } else {
                world.gold += 25;
                floatText(x, y, '+25', '#ffd34d');
                say('A heart, but yours are full. +25 gold instead.');
            }
            audio.play('heart');
        } else {
            const shrine = shrineIn(regionOf(x), regionOf(y));
            world.shrines.add(shrine.key);
            world.gold += 100;
            floatText(x, y, '+100 ♥', '#ffe680');
            world.hearts = Math.min(MAX_HEARTS, world.hearts + 1);
            audio.play('shrine');
            const total = place().shrines.length, left = shrinesLeft().length;
            say(`Shrine ${total - left} of ${total} in ${place().name}. +100 gold and a heart.`);
            if (!left) toast(`The gate of ${place().name} has opened. Find it to travel on.`);
        }
    }

    // Step through an open gate into the next place; a sealed one says why not.
    function useGate() {
        const left = shrinesLeft().length;
        if (left) {
            audio.play('deny');
            say(`The gate is sealed. Visit ${left} more ${left === 1 ? 'shrine' : 'shrines'} in ${place().name} to open it.`);
            changed();
            return true;
        }
        const leaving = place().name;
        stopWalking();
        world.bonus += 250 + world.farthest * 5;
        world.places.push(leaving);
        world.level++;
        world.gen = 3;
        world.seed = (Math.random() * 4294967296) >>> 0;
        arrive();
        currentBiome = biomeAt(0, 0);
        audio.play('gate');
        toast(`You leave ${leaving} behind…`);
        announcePlace();
        changed();
        save();
        return true;
    }

    function announcePlace() {
        const here = place();
        toast(`Place ${world.level}: ${here.name}`);
        say(`${here.name}. ${here.line} Find its ${here.shrines.length} shrines to open the gate onward.`);
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
        const route = [...world.places, place().name].join(' → ');
        const crossed = world.places.length;
        overText.textContent = `Your road: ${route}. `
            + `${crossed ? `You crossed ${crossed} ${crossed === 1 ? 'gate' : 'gates'}, ` : ''}`
            + `uncovered ${world.explored} cells and gathered ${world.gold} gold. `
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
            gold: world.gold, biomes: world.biomesSeen.length, places: world.places.length,
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
        for (const shrine of place().shrines) dot(shrine.x, shrine.y, world.shrines.has(shrine.key) ? '#9aa1bd' : '#f6c945', 1);
        dot(place().gate.x, place().gate.y, gateOpen() ? '#c49bff' : '#6b6f86', 2);
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
        let found = null, foundDistance = Infinity;
        for (const shrine of shrinesLeft()) {
            const d = Math.hypot(shrine.x - world.px, shrine.y - world.py);
            if (d < foundDistance) { found = shrine; foundDistance = d; }
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

        const here = place();
        placeEl.textContent = here.name;
        placeLevelEl.textContent = `Place ${world.level}`;
        placeLineEl.textContent = here.line;
        const total = here.shrines.length, found = total - shrinesLeft().length;
        const target = nearestShrine() ?? here.gate;
        const dx = target.x - world.px, dy = target.y - world.py;
        const names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
        const angle = Math.atan2(dy, dx);
        const where = dx || dy
            ? `${Math.max(Math.abs(dx), Math.abs(dy))} cells ${names[(Math.round(angle / (Math.PI / 4)) + 8) % 8]}`
            : 'right here';
        arrowEl.style.transform = `rotate(${angle}rad)`;
        compassText.textContent = gateOpen()
            ? `All ${total} shrines found. The gate is open: ${where}.`
            : `Shrines ${found}/${total}. Nearest: ${where}.`;
        compassEl.classList.toggle('open', gateOpen());
    }

    // ---- Tile art, painted once per zoom level and reused ------------------

    let sprites = new Map(), spriteSize = 0, spriteDpr = 0;

    function sprite(key, paint) {
        const dpr = window.devicePixelRatio || 1;
        if (spriteSize !== size || spriteDpr !== dpr) {
            sprites = new Map();
            spriteSize = size;
            spriteDpr = dpr;
        }
        let art = sprites.get(key);
        if (!art) {
            art = document.createElement('canvas');
            const px = Math.max(1, Math.ceil(size * dpr));
            art.width = art.height = px;
            const c = art.getContext('2d');
            c.scale(px / size, px / size);
            paint(c, size);
            sprites.set(key, art);
        }
        return art;
    }

    function shadeColour(hex, amount) {
        const n = parseInt(hex.replace('#', ''), 16);
        const f = (v) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
        return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
    }

    function tilePath(c, s, inset, radius) {
        c.beginPath();
        if (c.roundRect) c.roundRect(inset, inset, s - inset * 2, s - inset * 2, radius);
        else c.rect(inset, inset, s - inset * 2, s - inset * 2);
    }

    // Raised, unexplored ground: lit from above, shadowed below, with a little
    // detail that says which land you are in.
    function paintHidden(c, s, biome, lift, detail) {
        const r = s * 0.16;
        const fill = c.createLinearGradient(0, 0, 0, s);
        fill.addColorStop(0, shadeColour(biome.tint, 0.08 + lift));
        fill.addColorStop(1, shadeColour(biome.tint, -0.04 + lift));
        tilePath(c, s, 1, r);
        c.fillStyle = fill;
        c.fill();
        c.save();
        tilePath(c, s, 1, r);
        c.clip();
        c.fillStyle = 'rgba(255, 255, 255, 0.12)';
        c.fillRect(0, 1, s, Math.max(1, s * 0.06));
        c.fillStyle = 'rgba(0, 0, 0, 0.3)';
        const base = Math.max(1.5, s * 0.1);
        c.fillRect(0, s - 1 - base, s, base);
        c.restore();
        if (detail && s >= 16) paintDetail(c, s, biome.detail, detail);
    }

    function paintDetail(c, s, kind, variant) {
        const ox = (variant - 2) * s * 0.14;
        c.lineCap = 'round';
        if (kind === 'grass') {
            c.strokeStyle = 'rgba(150, 210, 130, 0.5)';
            c.lineWidth = Math.max(1, s * 0.05);
            c.beginPath();
            for (const [x, lean] of [[0.38, -0.06], [0.46, 0], [0.54, 0.07]]) {
                c.moveTo(s * x + ox, s * 0.74);
                c.lineTo(s * (x + lean) + ox, s * 0.56);
            }
            c.stroke();
        } else if (kind === 'tree') {
            c.fillStyle = 'rgba(16, 52, 38, 0.6)';
            c.beginPath();
            c.moveTo(s * 0.5 + ox, s * 0.26);
            c.lineTo(s * 0.66 + ox, s * 0.62);
            c.lineTo(s * 0.34 + ox, s * 0.62);
            c.closePath();
            c.fill();
            c.fillRect(s * 0.47 + ox, s * 0.62, s * 0.06, s * 0.1);
        } else if (kind === 'reed') {
            c.fillStyle = 'rgba(120, 175, 170, 0.3)';
            c.beginPath();
            c.ellipse(s * 0.5 + ox, s * 0.7, s * 0.2, s * 0.06, 0, 0, Math.PI * 2);
            c.fill();
            c.strokeStyle = 'rgba(170, 190, 120, 0.55)';
            c.lineWidth = Math.max(1, s * 0.04);
            c.beginPath();
            c.moveTo(s * 0.44 + ox, s * 0.7);
            c.lineTo(s * 0.42 + ox, s * 0.36);
            c.moveTo(s * 0.54 + ox, s * 0.7);
            c.lineTo(s * 0.57 + ox, s * 0.42);
            c.stroke();
        } else if (kind === 'snow') {
            c.fillStyle = 'rgba(255, 255, 255, 0.55)';
            for (const [x, y] of [[0.3, 0.34], [0.62, 0.3], [0.48, 0.55], [0.7, 0.66], [0.28, 0.7]]) {
                c.beginPath();
                c.arc(s * x + ox * 0.5, s * y, Math.max(0.8, s * 0.035), 0, Math.PI * 2);
                c.fill();
            }
        } else if (kind === 'ember') {
            c.strokeStyle = 'rgba(20, 8, 8, 0.45)';
            c.lineWidth = Math.max(1, s * 0.04);
            c.beginPath();
            c.moveTo(s * 0.26 + ox, s * 0.4);
            c.lineTo(s * 0.44 + ox, s * 0.5);
            c.lineTo(s * 0.4 + ox, s * 0.66);
            c.stroke();
            c.fillStyle = 'rgba(255, 140, 80, 0.65)';
            c.beginPath();
            c.arc(s * 0.62 + ox * 0.5, s * 0.58, Math.max(0.9, s * 0.04), 0, Math.PI * 2);
            c.fill();
        }
    }

    // Uncovered ground sits lower, with a soft shadow along its top edge.
    function paintOpen(c, s) {
        tilePath(c, s, 1, s * 0.14);
        c.fillStyle = C.open;
        c.fill();
        c.save();
        c.clip();
        const shadow = c.createLinearGradient(0, 0, 0, s * 0.3);
        shadow.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
        shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        c.fillStyle = shadow;
        c.fillRect(0, 0, s, s * 0.3);
        c.restore();
    }

    function paintMine(c, s, cx, cy, r) {
        c.strokeStyle = '#14151d';
        c.lineWidth = Math.max(1.2, r * 0.32);
        c.lineCap = 'round';
        c.beginPath();
        for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4;
            c.moveTo(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
            c.lineTo(cx + Math.cos(a) * r * 1.45, cy + Math.sin(a) * r * 1.45);
        }
        c.stroke();
        const body = c.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
        body.addColorStop(0, '#6d7290');
        body.addColorStop(1, '#14151d');
        c.fillStyle = body;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255, 255, 255, 0.75)';
        c.beginPath();
        c.arc(cx - r * 0.38, cy - r * 0.38, r * 0.2, 0, Math.PI * 2);
        c.fill();
    }

    // A crater: scorched, with the spent mine still in it.
    function paintBlast(c, s) {
        tilePath(c, s, 1, s * 0.14);
        const scorch = c.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.62);
        scorch.addColorStop(0, '#ff7a55');
        scorch.addColorStop(0.35, '#a3262f');
        scorch.addColorStop(1, '#2a0d12');
        c.fillStyle = scorch;
        c.fill();
        paintMine(c, s, s / 2, s / 2, s * 0.17);
    }

    function paintFlag(c, s) {
        c.fillStyle = 'rgba(0, 0, 0, 0.3)';
        c.beginPath();
        c.ellipse(s * 0.42, s * 0.79, s * 0.17, s * 0.05, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#dfe2ee';
        c.fillRect(s * 0.38, s * 0.2, Math.max(1.5, s * 0.06), s * 0.58);
        c.fillStyle = C.flag;
        c.beginPath();
        c.moveTo(s * 0.42, s * 0.2);
        c.lineTo(s * 0.76, s * 0.34);
        c.lineTo(s * 0.42, s * 0.48);
        c.closePath();
        c.fill();
        c.fillStyle = 'rgba(255, 255, 255, 0.28)';
        c.beginPath();
        c.moveTo(s * 0.42, s * 0.2);
        c.lineTo(s * 0.76, s * 0.34);
        c.lineTo(s * 0.42, s * 0.34);
        c.closePath();
        c.fill();
    }

    function paintChest(c, s) {
        const x = s * 0.24, w = s * 0.52;
        c.fillStyle = 'rgba(0, 0, 0, 0.35)';
        c.beginPath();
        c.ellipse(s / 2, s * 0.76, s * 0.28, s * 0.06, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#8a5a2e';
        tilePathAt(c, x, s * 0.42, w, s * 0.32, s * 0.05);
        c.fill();
        c.fillStyle = '#b37a3f';
        tilePathAt(c, x - s * 0.02, s * 0.3, w + s * 0.04, s * 0.15, s * 0.06);
        c.fill();
        c.fillStyle = '#f6c945';
        c.fillRect(s * 0.46, s * 0.3, s * 0.08, s * 0.44);
        c.fillRect(x, s * 0.43, w, Math.max(1, s * 0.04));
        c.fillStyle = '#fff3c4';
        c.fillRect(s * 0.47, s * 0.47, s * 0.06, s * 0.07);
    }

    function tilePathAt(c, x, y, w, h, r) {
        c.beginPath();
        if (c.roundRect) c.roundRect(x, y, w, h, r);
        else c.rect(x, y, w, h);
    }

    function paintHeart(c, s) {
        const fill = c.createLinearGradient(0, s * 0.25, 0, s * 0.78);
        fill.addColorStop(0, '#ff9a9a');
        fill.addColorStop(1, '#d63c50');
        c.fillStyle = fill;
        c.beginPath();
        c.moveTo(s * 0.5, s * 0.76);
        c.bezierCurveTo(s * 0.12, s * 0.52, s * 0.18, s * 0.22, s * 0.5, s * 0.36);
        c.bezierCurveTo(s * 0.82, s * 0.22, s * 0.88, s * 0.52, s * 0.5, s * 0.76);
        c.fill();
        c.fillStyle = 'rgba(255, 255, 255, 0.55)';
        c.beginPath();
        c.ellipse(s * 0.36, s * 0.38, s * 0.06, s * 0.04, -0.6, 0, Math.PI * 2);
        c.fill();
    }

    // A shrine stone: a faceted gem on a plinth, glowing until it is visited.
    function paintShrine(c, s, visited) {
        if (!visited) {
            const glow = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
            glow.addColorStop(0, 'rgba(246, 201, 69, 0.5)');
            glow.addColorStop(1, 'rgba(246, 201, 69, 0)');
            c.fillStyle = glow;
            c.fillRect(0, 0, s, s);
        }
        c.fillStyle = visited ? '#4a4f66' : '#6b5a2a';
        tilePathAt(c, s * 0.3, s * 0.7, s * 0.4, s * 0.1, s * 0.03);
        c.fill();
        const top = s * 0.14, mid = s * 0.42, bottom = s * 0.7, half = s * 0.2;
        c.fillStyle = visited ? '#9aa1bd' : '#ffe08a';
        c.beginPath();
        c.moveTo(s / 2, top);
        c.lineTo(s / 2 - half, mid);
        c.lineTo(s / 2, bottom);
        c.closePath();
        c.fill();
        c.fillStyle = visited ? '#727891' : '#e8b42f';
        c.beginPath();
        c.moveTo(s / 2, top);
        c.lineTo(s / 2 + half, mid);
        c.lineTo(s / 2, bottom);
        c.closePath();
        c.fill();
        c.fillStyle = 'rgba(255, 255, 255, 0.8)';
        c.beginPath();
        c.arc(s * 0.45, s * 0.3, Math.max(0.8, s * 0.03), 0, Math.PI * 2);
        c.fill();
    }

    function paintGate(c, s, open) {
        const w = s * 0.62, h = s * 0.8, left = (s - w) / 2, bottom = s / 2 + h / 2, top = s / 2 - h / 2;
        const arch = (inset) => {
            c.beginPath();
            c.moveTo(left + inset, bottom);
            c.lineTo(left + inset, top + w / 2);
            c.arc(s / 2, top + w / 2, w / 2 - inset, Math.PI, 0);
            c.lineTo(left + w - inset, bottom);
            c.closePath();
        };
        c.fillStyle = open ? '#a77de8' : '#5d6178';
        arch(0);
        c.fill();
        c.fillStyle = open ? '#c9a8ff' : '#7a7f97';
        arch(s * 0.04);
        c.fill();
        if (open) {
            const portal = c.createLinearGradient(0, top, 0, bottom);
            portal.addColorStop(0, '#ffffff');
            portal.addColorStop(1, '#d7c1ff');
            c.fillStyle = portal;
        } else {
            c.fillStyle = '#14161f';
        }
        arch(s * 0.12);
        c.fill();
        if (!open) {
            c.fillStyle = '#9aa1bd';
            c.fillRect(s * 0.46, s * 0.55, s * 0.08, s * 0.1);
        }
    }

    const reveals = new Map();   // recently opened cells: key -> { t, delay }
    let floaters = [];           // rising '+gold' labels from pickups
    function floatText(x, y, text, colour) {
        floaters.push({ x, y, text, colour, t: performance.now() });
        if (floaters.length > 6) floaters.shift();
    }
    let blastFx = null;          // the last explosion, while its ring expands

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
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `800 ${Math.round(size * 0.54)}px ui-rounded, ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
        const openTile = sprite('open', paintOpen);
        const flagTile = sprite('flag', paintFlag);
        const animating = reveals.size > 0;

        const hiddenTile = (x, y) => {
            const biome = biomeAt(x, y), lift = Math.floor(hash(x, y, 5) * 4), roll = hash(x, y, 6);
            const detail = roll < 0.3 ? 1 + Math.floor(roll / 0.1) : 0;
            return sprite(`h${biome.id}.${lift}.${detail}`, (c, s) => paintHidden(c, s, biome, (lift - 1.5) * 0.025, detail));
        };
        const item = (kind, x, y) => {
            if (kind === 'gold') return sprite('chest', paintChest);
            if (kind === 'heart') return sprite('heart', paintHeart);
            if (kind === 'gate') return gateOpen() ? sprite('gate1', (c, s) => paintGate(c, s, true)) : sprite('gate0', (c, s) => paintGate(c, s, false));
            const visited = world.shrines.has(shrineIn(regionOf(x), regionOf(y)).key);
            return sprite(visited ? 'shrine1' : 'shrine0', (c, s) => paintShrine(c, s, visited));
        };

        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const sx = screenX(x), sy = screenY(y), cx = sx + size / 2, cy = sy + size / 2 + size * 0.03;
                const value = cellAt(x, y), state = value & 3;
                const pickup = state === OPEN || state === HIDDEN ? pickupAt(x, y) : null;

                if (state === OPEN) {
                    // Freshly opened ground rises into place, rippling out from where you stepped.
                    let grow = 1;
                    if (animating) {
                        const key = x + ',' + y, reveal = reveals.get(key);
                        if (reveal) {
                            grow = (now - reveal.t - reveal.delay) / 220;
                            if (grow >= 1) { reveals.delete(key); grow = 1; }
                        }
                    }
                    if (grow < 1) {
                        g.drawImage(hiddenTile(x, y), sx, sy, size, size);
                        if (grow <= 0) continue;
                        const scale = 0.7 + 0.3 * grow, inset = (size * (1 - scale)) / 2;
                        g.globalAlpha = grow;
                        g.drawImage(openTile, sx + inset, sy + inset, size * scale, size * scale);
                    } else {
                        g.drawImage(openTile, sx, sy, size, size);
                    }
                    const landmark = pickup === 'shrine' || pickup === 'gate';
                    if ((pickup && !(value & TAKEN)) || landmark) {
                        g.drawImage(item(pickup, x, y), sx, sy, size, size);
                    } else {
                        const n = adjacent(x, y);
                        if (n) {
                            if (size >= 18) {
                                g.fillStyle = 'rgba(0, 0, 0, 0.55)';
                                g.fillText(n, cx, cy + Math.max(1, size * 0.04));
                            }
                            g.fillStyle = NUMBER_COLOURS[n];
                            g.fillText(n, cx, cy);
                        }
                    }
                    g.globalAlpha = 1;
                } else if (state === BLAST) {
                    g.drawImage(sprite('blast', paintBlast), sx, sy, size, size);
                } else {
                    g.drawImage(hiddenTile(x, y), sx, sy, size, size);
                    if (state === FLAG) {
                        g.drawImage(flagTile, sx, sy, size, size);
                    } else if (pickup === 'shrine' || pickup === 'gate') {
                        // Shrines and the gate are landmarks: they show through the fog.
                        g.globalAlpha = 0.7;
                        g.drawImage(item(pickup, x, y), sx, sy, size, size);
                        g.globalAlpha = 1;
                    }
                }
            }
        }

        // An open gate throws light around it.
        if (gateOpen()) {
            const gx = (place().gate.x - cam.x) * size + w / 2, gy = (place().gate.y - cam.y) * size + h / 2;
            if (gx > -size * 3 && gx < w + size * 3 && gy > -size * 3 && gy < h + size * 3) {
                const halo = g.createRadialGradient(gx, gy, 0, gx, gy, size * 2.2);
                halo.addColorStop(0, 'rgba(196, 155, 255, 0.45)');
                halo.addColorStop(1, 'rgba(196, 155, 255, 0)');
                g.fillStyle = halo;
                g.fillRect(gx - size * 2.2, gy - size * 2.2, size * 4.4, size * 4.4);
            }
        }

        // The ring of the last explosion.
        if (blastFx) {
            const p = (now - blastFx.t) / 520;
            if (p >= 1) {
                blastFx = null;
            } else {
                const bx = (blastFx.x - cam.x) * size + w / 2, by = (blastFx.y - cam.y) * size + h / 2;
                g.fillStyle = `rgba(255, 170, 110, ${0.45 * (1 - p)})`;
                g.beginPath();
                g.arc(bx, by, size * (0.6 + p * 1.4), 0, Math.PI * 2);
                g.fill();
                g.strokeStyle = `rgba(255, 120, 80, ${1 - p})`;
                g.lineWidth = Math.max(2, size * 0.12 * (1 - p));
                g.beginPath();
                g.arc(bx, by, size * (0.5 + p * 2.8), 0, Math.PI * 2);
                g.stroke();
            }
        }

        // Darkness beyond the lantern's reach.
        const px = (world.px - cam.x) * size + w / 2, py = (world.py - cam.y) * size + h / 2;
        const light = g.createRadialGradient(px, py, size * 4, px, py, size * 14);
        light.addColorStop(0, 'rgba(10, 12, 20, 0)');
        light.addColorStop(1, 'rgba(10, 12, 20, 0.55)');
        g.fillStyle = light;
        g.fillRect(-10, 0, w + 20, h);

        drawAdventurer(px, py);

        // Pickup labels drift up and fade.
        floaters = floaters.filter((f) => now - f.t < 1100);
        if (floaters.length) {
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.font = `bold ${Math.max(12, Math.round(size * 0.5))}px system-ui, sans-serif`;
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
            for (const f of floaters) {
                const p = (now - f.t) / 1100;
                const fx = (f.x - cam.x) * size + w / 2;
                const fy = (f.y - cam.y) * size + h / 2 - size * (0.4 + p * 1.4);
                g.globalAlpha = p < 0.7 ? 1 : (1 - p) / 0.3;
                g.strokeText(f.text, fx, fy);
                g.fillStyle = f.colour;
                g.fillText(f.text, fx, fy);
            }
            g.globalAlpha = 1;
        }
    }

    // A small traveller in a blue cloak and a wide hat, holding up a lantern.
    function drawAdventurer(px, py) {
        const s = size, out = world.over;
        const lx = px + s * 0.28, ly = py + s * 0.02;

        if (!out) {
            const glow = g.createRadialGradient(lx, ly, 0, lx, ly, s * 1.5);
            glow.addColorStop(0, 'rgba(255, 214, 120, 0.5)');
            glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
            g.fillStyle = glow;
            g.fillRect(lx - s * 1.5, ly - s * 1.5, s * 3, s * 3);
        }

        g.fillStyle = 'rgba(0, 0, 0, 0.4)';
        g.beginPath();
        g.ellipse(px, py + s * 0.34, s * 0.26, s * 0.08, 0, 0, Math.PI * 2);
        g.fill();

        g.lineWidth = Math.max(1, s * 0.05);
        g.strokeStyle = '#0e1238';

        // Cloak
        g.fillStyle = out ? '#5d6178' : '#3f5fe0';
        g.beginPath();
        g.moveTo(px - s * 0.25, py + s * 0.33);
        g.quadraticCurveTo(px - s * 0.22, py - s * 0.08, px, py - s * 0.1);
        g.quadraticCurveTo(px + s * 0.22, py - s * 0.08, px + s * 0.25, py + s * 0.33);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = out ? '#727891' : '#6f8bff';
        g.beginPath();
        g.moveTo(px - s * 0.04, py - s * 0.08);
        g.lineTo(px + s * 0.04, py - s * 0.08);
        g.lineTo(px + s * 0.07, py + s * 0.32);
        g.lineTo(px - s * 0.07, py + s * 0.32);
        g.closePath();
        g.fill();

        // Lantern on its arm
        g.strokeStyle = '#0e1238';
        g.beginPath();
        g.moveTo(px + s * 0.14, py + s * 0.02);
        g.lineTo(lx, ly - s * 0.08);
        g.stroke();
        g.fillStyle = out ? '#9aa1bd' : '#ffd678';
        g.beginPath();
        g.arc(lx, ly, s * 0.08, 0, Math.PI * 2);
        g.fill();
        g.stroke();

        // Head
        g.fillStyle = out ? '#b9bccb' : '#ffd9a8';
        g.beginPath();
        g.arc(px, py - s * 0.19, s * 0.13, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#0e1238';
        g.beginPath();
        g.arc(px - s * 0.045, py - s * 0.18, Math.max(0.8, s * 0.022), 0, Math.PI * 2);
        g.arc(px + s * 0.045, py - s * 0.18, Math.max(0.8, s * 0.022), 0, Math.PI * 2);
        g.fill();

        // Hat
        g.fillStyle = out ? '#4a4f66' : '#7a4a24';
        g.beginPath();
        g.ellipse(px, py - s * 0.27, s * 0.22, s * 0.055, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = out ? '#5d6178' : '#98602f';
        g.beginPath();
        g.moveTo(px - s * 0.12, py - s * 0.28);
        g.quadraticCurveTo(px - s * 0.1, py - s * 0.44, px + s * 0.02, py - s * 0.46);
        g.quadraticCurveTo(px + s * 0.11, py - s * 0.4, px + s * 0.12, py - s * 0.28);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = out ? '#727891' : '#f6c945';
        g.fillRect(px - s * 0.11, py - s * 0.32, s * 0.22, Math.max(1, s * 0.035));
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
        if (now < shakeUntil || reveals.size || blastFx || floaters.length) dirty = true;
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
    const touches = new Map();   // pointers currently down, for pinch zoom
    let pinch = null, pinched = false;

    function twoFingers() {
        const [a, b] = [...touches.values()];
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    }

    canvas.addEventListener('pointerdown', (e) => {
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(e.pointerId);
        if (e.pointerType !== 'mouse') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // A second finger turns the gesture into a pinch: no tap, no flag.
        if (touches.size >= 2) {
            if (press) clearTimeout(press.timer);
            press = null;
            pinched = true;
            const now = twoFingers();
            pinch = { distance: now.distance, size, x: now.x, y: now.y };
            return;
        }

        press = { x: e.clientX, y: e.clientY, button: e.button, panned: false, flagged: false, timer: null };
        if (e.pointerType !== 'mouse') {
            press.timer = setTimeout(() => {
                if (!press) return;
                press.flagged = true;
                const [x, y] = cellAtPointer(e);
                toggleFlag(x, y);
                if (navigator.vibrate) navigator.vibrate(15);
            }, 400);
        }
    });

    canvas.addEventListener('pointermove', (e) => {
        if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pinch && touches.size >= 2) {
            const now = twoFingers();
            // Follow the fingers: zoom around their midpoint and pan as it moves.
            cam.free = true;
            cam.x -= (now.x - pinch.x) / size;
            cam.y -= (now.y - pinch.y) / size;
            pinch.x = now.x;
            pinch.y = now.y;
            zoomAt(pinch.size * (now.distance / pinch.distance), now.x, now.y);
            return;
        }

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

    function liftPointer(e) {
        touches.delete(e.pointerId);
        if (touches.size < 2) pinch = null;
        if (touches.size === 0 && pinched) {
            pinched = false;
            saveZoom();
            return true;
        }
        return pinched;
    }

    canvas.addEventListener('pointerup', (e) => {
        const wasPinch = liftPointer(e);
        if (!press) return;
        clearTimeout(press.timer);
        const done = press;
        press = null;
        if (wasPinch || done.panned || done.flagged) return;
        const [x, y] = cellAtPointer(e);
        if (done.button === 2 || flagMode) toggleFlag(x, y);
        else if (done.button === 0) goTo(x, y);
    });
    canvas.addEventListener('pointercancel', (e) => {
        liftPointer(e);
        if (press) clearTimeout(press.timer);
        press = null;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const MIN_SIZE = 12, MAX_SIZE = 64;

    // Zoom so the map point under (clientX, clientY) stays put.
    function zoomAt(newSize, clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const ox = clientX - rect.left - rect.width / 2, oy = clientY - rect.top - rect.height / 2;
        const wx = cam.x + ox / size, wy = cam.y + oy / size;
        size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, newSize));
        if (ox || oy) {
            cam.x = wx - ox / size;
            cam.y = wy - oy / size;
            cam.free = true;
        }
        dirty = true;
    }

    // Zoom around the middle of the view (buttons and keys).
    function zoom(factor) {
        const rect = canvas.getBoundingClientRect();
        zoomAt(size * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
        saveZoom();
    }

    function saveZoom() {
        try { localStorage.setItem('adventureZoom', String(Math.round(size))); } catch (e) { /* ignore */ }
    }

    try {
        const savedZoom = Number(localStorage.getItem('adventureZoom'));
        if (savedZoom >= MIN_SIZE && savedZoom <= MAX_SIZE) size = savedZoom;
    } catch (e) { /* ignore */ }

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoomAt(size * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
        saveZoom();
    }, { passive: false });

    $('adv-zoom-in').addEventListener('click', () => zoom(1.25));
    $('adv-zoom-out').addEventListener('click', () => zoom(1 / 1.25));

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
        currentBiome = biomeAt(0, 0);
        overEl.hidden = true;
        announcePlace();
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
    else if (resumed) say(`Welcome back to ${place().name}. Your journey continues where you left it.`);
    else announcePlace();
    requestAnimationFrame(frame);

    // Exposed for automated checks only.
    window.__adventure = { get world() { return world; }, isMine, stateAt, shrineIn, route, place };
})();
