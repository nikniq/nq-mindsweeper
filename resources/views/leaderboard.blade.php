@extends('layout')

@section('title', 'Leaderboard')

@section('content')
    <section class="panel wide">
        <h1>Leaderboard</h1>

        <div class="difficulty">
            @foreach (\App\Models\Score::DIFFICULTIES as $key => $d)
                <a href="{{ route('leaderboard', ['difficulty' => $key]) }}" @class(['active' => $key === $difficulty])>{{ $d['label'] }}</a>
            @endforeach
        </div>

        @if ($difficulty === \App\Models\Score::DAILY)
            <p class="sub">Today's board ({{ $day }}, UTC). Everyone plays the same mines and only a first attempt counts.</p>
        @endif

        @if ($rows->isEmpty())
            <p class="empty">No times yet for this difficulty. <a href="{{ route('game') }}">Be the first.</a></p>
        @else
            <table class="scores">
                <thead>
                    <tr><th>#</th><th>Player</th><th class="num">{{ $difficulty === \App\Models\Score::DAILY ? 'Time' : 'Best time' }}</th>@if ($difficulty !== \App\Models\Score::DAILY)<th class="num">Wins</th>@endif</tr>
                </thead>
                <tbody>
                    @foreach ($rows as $i => $row)
                        <tr @class(['me' => auth()->id() === (int) $row->user_id])>
                            <td>{{ $i + 1 }}</td>
                            <td>{{ $row->name }}</td>
                            <td class="num">{{ number_format($row->best_ms / 1000, 2) }}s</td>
                            @if ($difficulty !== \App\Models\Score::DAILY)
                                <td class="num">{{ $row->wins }}</td>
                            @endif
                        </tr>
                    @endforeach
                </tbody>
            </table>
        @endif

        @auth
            <form method="POST" action="{{ route('name.update') }}" class="rename" id="name">
                @csrf
                @method('PATCH')
                <label for="name-input">Your leaderboard name</label>
                <div class="row">
                    <input id="name-input" type="text" name="name" value="{{ old('name', auth()->user()->name) }}" minlength="2" maxlength="20" required autocomplete="nickname">
                    <button type="submit" class="btn small">Save</button>
                </div>
                @error('name') <span class="error">{{ $message }}</span> @enderror
            </form>
        @endauth
    </section>
@endsection
