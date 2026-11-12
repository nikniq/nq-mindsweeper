@extends('layout')

@section('title', 'Log in')

@section('content')
    <section class="panel">
        <h1>Log in</h1>

        <form method="POST" action="{{ route('login') }}" class="form">
            @csrf
            <label>Email
                <input type="email" name="email" value="{{ old('email') }}" required autofocus autocomplete="email">
                @error('email') <span class="error">{{ $message }}</span> @enderror
            </label>
            <label>Password <span class="hint">(leave empty if you registered with only an email)</span>
                <input type="password" name="password" autocomplete="current-password">
                @error('password') <span class="error">{{ $message }}</span> @enderror
            </label>
            <label class="check"><input type="checkbox" name="remember" value="1"> Keep me logged in</label>
            <button type="submit" class="btn">Log in</button>
        </form>

        @if (\App\Http\Controllers\AuthController::googleEnabled())
            <p class="or"><span>or</span></p>
            <a class="btn google" href="{{ route('google.redirect') }}">Continue with Google</a>
        @endif

        <p class="sub">New here? <a href="{{ route('register') }}">Register</a></p>
    </section>
@endsection
