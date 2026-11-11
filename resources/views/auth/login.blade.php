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
            <label>Password
                <input type="password" name="password" required autocomplete="current-password">
                @error('password') <span class="error">{{ $message }}</span> @enderror
            </label>
            <label class="check"><input type="checkbox" name="remember" value="1"> Keep me logged in</label>
            <button type="submit" class="btn">Log in</button>
        </form>

        <p class="sub">New here? <a href="{{ route('register') }}">Register</a></p>
    </section>
@endsection
