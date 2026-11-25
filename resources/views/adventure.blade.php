@extends('layout')

@section('title', 'Adventure')

@section('content')
    <section class="adventure" id="adventure">
        <div class="adv-hud">
            <div class="readout" title="Hearts: a mine costs one"><span class="label">Hearts</span><span id="adv-hearts" class="hearts">♥♥♥</span></div>
            <div class="readout" title="Gold from chests and shrines"><span class="label">Gold</span><span id="adv-gold">0</span></div>
            <div class="readout" title="Cells uncovered"><span class="label">Explored</span><span id="adv-explored">0</span></div>
            <div class="readout" title="Farthest distance from camp"><span class="label">Farthest</span><span id="adv-farthest">0</span></div>
            <div class="readout" title="Gold + explored + 5 × farthest"><span class="label">Score</span><span id="adv-score">0</span></div>
        </div>

        <p id="adv-compass" class="tip compass">
            <span id="adv-biome" class="biome">Quiet Meadows</span>
            <span aria-hidden="true">·</span>
            <span id="adv-arrow" class="arrow" aria-hidden="true">➤</span> <span id="adv-compass-text">Looking for shrines…</span>
        </p>

        <div class="toggles">
            <button type="button" id="adv-flag" class="toggle" aria-pressed="false" title="Clicks place flags instead of moving (F)">
                <span aria-hidden="true">⚑</span> Flag mode
            </button>
            <button type="button" id="adv-scout" class="toggle" title="Spend 40 gold to flag every mine within two cells (R)">
                <span aria-hidden="true">🔭</span> Scout <small>40g</small>
            </button>
            <button type="button" id="adv-center" class="toggle" title="Bring the view back to your adventurer (C)">
                <span aria-hidden="true">◎</span> Find me
            </button>
            <button type="button" id="music" class="toggle" aria-pressed="false" title="Background music (M)">
                <span aria-hidden="true">♪</span> Music
            </button>
            <button type="button" id="sound" class="toggle" aria-pressed="false" title="Sound effects">
                <span aria-hidden="true">🔔</span> Sound
            </button>
            <button type="button" id="adv-new" class="toggle" title="Start again in a new world (N)">
                <span aria-hidden="true">🗺</span> New world
            </button>
        </div>

        <div class="world-wrap">
            <canvas id="world" class="world" tabindex="0" role="application"
                    aria-label="Adventure map. Arrow keys or WASD walk, Q E Z X walk diagonally, Shift with a direction flags that cell."></canvas>
            <canvas id="adv-minimap" class="minimap" width="128" height="128" aria-hidden="true" title="Map: uncovered ground, shrines (gold), camp (green) and you (white)"></canvas>
            <div class="zoom-controls">
                <button type="button" id="adv-zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>
                <button type="button" id="adv-zoom-out" aria-label="Zoom out" title="Zoom out (−)">−</button>
            </div>
            <p id="adv-toast" class="adv-toast" role="status" aria-live="polite" hidden></p>
            <div id="adv-over" class="adv-over" hidden>
                <h2>Journey over</h2>
                <p id="adv-over-text"></p>
                <button type="button" id="adv-restart" class="btn">Set out into a new world</button>
            </div>
        </div>

        <p id="adv-status" class="stats" role="status" aria-live="polite"></p>

        <div class="help">
            <p>
                The map never ends. Walk onto a hidden cell to uncover it, and read the numbers to avoid mines: each one costs a heart.
                Chests (◆) hold gold, hearts (♥) heal, and shrines (✦) restore a heart and pay well. The compass points to the nearest one you have not visited.
                Mines grow denser the farther you roam, and thicker still in some lands, such as the Ashen Wastes.
                Short on nerve? Scout (40 gold) flags every mine within two cells of you.
            </p>
            <p>
                Click or tap to walk, even across the map along cells you have uncovered. Right-click or long-press to flag. Drag to look around; scroll, pinch or use the + and − buttons to zoom.
                Keys: arrows or WASD walk, Q E Z X diagonally, Shift with a direction flags, F flag mode, R scout, C find me, + and − zoom, M music.
                Your journey is saved in this browser.
            </p>
        </div>
    </section>
@endsection

@push('scripts')
    <script src="{{ asset('js/audio.js') }}?v={{ filemtime(public_path('js/audio.js')) }}" defer></script>
    <script src="{{ asset('js/adventure.js') }}?v={{ filemtime(public_path('js/adventure.js')) }}" defer></script>
@endpush
