@extends('layout')

@section('title', 'Register')

@section('content')
    <section class="panel">
        <h1>Register</h1>
        <p class="sub">Just your email. It is never shown; you get a nickname for the leaderboard.</p>

        <form method="POST" action="{{ route('register') }}" class="form">
            @csrf
            <label>Email
                <input type="email" name="email" value="{{ old('email') }}" required autofocus autocomplete="email">
                @error('email') <span class="error">{{ $message }}</span> @enderror
            </label>
            <button type="submit" class="btn">Create account</button>
        </form>

        @if (\App\Http\Controllers\AuthController::googleEnabled())
            <p class="or"><span>or</span></p>
            <a class="btn google" href="{{ route('google.redirect') }}">Continue with Google</a>
        @endif

        <p class="sub">Already registered? <a href="{{ route('login') }}">Log in</a></p>
    </section>
@endsection
