<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', 'Play') · {{ config('app.name') }}</title>
    <link rel="stylesheet" href="{{ asset('css/app.css') }}?v={{ filemtime(public_path('css/app.css')) }}">
</head>
<body>
    <header class="site-header">
        <a class="brand" href="{{ route('game') }}">{{ config('app.name') }}</a>
        <nav>
            <a href="{{ route('game') }}" @class(['active' => request()->routeIs('game')])>Play</a>
            <a href="{{ route('leaderboard') }}" @class(['active' => request()->routeIs('leaderboard')])>Leaderboard</a>
            @auth
                <a class="who" href="{{ route('leaderboard') }}#name" title="Change your name">{{ auth()->user()->name }}</a>
                <form method="POST" action="{{ route('logout') }}">
                    @csrf
                    <button type="submit" class="link">Log out</button>
                </form>
            @else
                <a href="{{ route('login') }}" @class(['active' => request()->routeIs('login')])>Log in</a>
                <a href="{{ route('register') }}" class="btn small">Register</a>
            @endauth
        </nav>
    </header>

    <main>
        @if (session('status'))
            <p class="notice" role="status">{{ session('status') }}</p>
        @endif

        @guest
            @if (session(\App\Models\Score::PENDING_KEY) && ! request()->routeIs('game'))
                <p class="notice" role="status">
                    You have a winning time waiting. Register or log in and it goes on the leaderboard under your name.
                </p>
            @endif
        @endguest

        @yield('content')
    </main>

    @stack('scripts')
</body>
</html>
