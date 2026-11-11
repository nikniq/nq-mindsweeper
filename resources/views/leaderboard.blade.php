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

        @if ($rows->isEmpty())
            <p class="empty">No times yet for this difficulty. <a href="{{ route('game') }}">Be the first.</a></p>
        @else
            <table class="scores">
                <thead>
                    <tr><th>#</th><th>Player</th><th class="num">Best time</th><th class="num">Wins</th></tr>
                </thead>
                <tbody>
                    @foreach ($rows as $i => $row)
                        <tr @class(['me' => auth()->id() === (int) $row->user_id])>
                            <td>{{ $i + 1 }}</td>
                            <td>{{ $row->name }}</td>
                            <td class="num">{{ number_format($row->best_ms / 1000, 2) }}s</td>
                            <td class="num">{{ $row->wins }}</td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        @endif
    </section>
@endsection
