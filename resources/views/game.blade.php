@extends('layout')

@section('title', 'Play')

@section('content')
    <section class="game" id="game"
             data-difficulties='@json($difficulties)'
             data-score-url="{{ route('scores.store') }}"
             data-authed="{{ auth()->check() ? '1' : '0' }}">
        <div class="difficulty" role="group" aria-label="Difficulty">
            @foreach ($difficulties as $key => $d)
                <button type="button" data-difficulty="{{ $key }}" title="{{ $d['cols'] }}×{{ $d['rows'] }}, {{ $d['mines'] }} mines">{{ $d['label'] }}</button>
            @endforeach
        </div>

        <div class="hud">
            <div class="readout" title="Mines left"><span class="label">Mines</span><span id="mines-left">0</span></div>
            <button type="button" id="new-game" class="btn">New game</button>
            <div class="readout" title="Time"><span class="label">Time</span><span id="timer">0.0</span></div>
        </div>

        <div class="toggles">
            <button type="button" id="flag-mode" class="toggle" aria-pressed="false" title="Tap cells to flag them instead of revealing (F)">
                <span aria-hidden="true">⚑</span> Flag mode
            </button>
            <button type="button" id="music" class="toggle" aria-pressed="false" title="Background music (M)">
                <span aria-hidden="true">♪</span> Music
            </button>
            <button type="button" id="sound" class="toggle" aria-pressed="false" title="Sound effects">
                <span aria-hidden="true">🔔</span> Sound
            </button>
        </div>

        <div class="board-wrap">
            <div id="board" class="board" role="grid" aria-label="Minefield"></div>
        </div>

        <div id="result" class="result" role="status" aria-live="polite" hidden>
            <p id="result-text"></p>
            <p id="result-guest" hidden>
                Want your name on the leaderboard?
                <a class="btn small" href="{{ route('register') }}">Register</a>
                or <a href="{{ route('login') }}">log in</a> and this time is saved for you.
            </p>
        </div>

        <p id="stats" class="stats"></p>

        <p class="help">
            Click to reveal. Right-click or long-press to flag, or switch on flag mode. Click a number with all its flags placed to clear around it.
            Keys: arrows move, Space reveals, F flags, N starts a new game, M toggles music, 1–3 change difficulty.
            @guest No account needed to play. @endguest
        </p>
    </section>
@endsection

@push('scripts')
    <script src="{{ asset('js/audio.js') }}?v={{ filemtime(public_path('js/audio.js')) }}" defer></script>
    <script src="{{ asset('js/game.js') }}?v={{ filemtime(public_path('js/game.js')) }}" defer></script>
@endpush
