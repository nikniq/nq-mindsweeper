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

        <p class="help">
            Click to reveal. Right-click or long-press to flag. Click a number with all its flags placed to clear around it.
            @guest No account needed to play. @endguest
        </p>
    </section>
@endsection

@push('scripts')
    <script src="{{ asset('js/game.js') }}" defer></script>
@endpush
