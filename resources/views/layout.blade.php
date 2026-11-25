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
        <div class="brand-group">
            <a class="nikniq-home" href="https://nikniq.com" title="Back to nikniq.com, more games"><span class="nq-logo" aria-hidden="true">nq</span><span class="sr-only">nikniq.com</span></a>
            <a class="brand" href="{{ route('game') }}">{{ config('app.name') }}</a>
        </div>
        <nav>
            <a href="{{ route('game') }}" @class(['active' => request()->routeIs('game')])>Play</a>
            <a href="{{ route('adventure') }}" @class(['active' => request()->routeIs('adventure')])>Adventure</a>
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

    <footer class="site-footer">
        <p>
            <a href="https://nikniq.com" class="footer-brand"><span class="nq-logo" aria-hidden="true">nq</span> A nikniq.com game</a>
            <span aria-hidden="true">·</span>
            <a href="https://nikniq.com">More games</a>
        </p>
        <nav aria-label="Footer">
            <a href="{{ route('game') }}">Play</a>
            <a href="{{ route('adventure') }}">Adventure</a>
            <a href="{{ route('leaderboard') }}">Leaderboard</a>
        </nav>
        <p class="fine">© {{ date('Y') }} {{ config('app.name') }}. Anyone can play; an account only puts your name on the leaderboard.</p>
    </footer>

    @stack('scripts')
</body>
</html>
