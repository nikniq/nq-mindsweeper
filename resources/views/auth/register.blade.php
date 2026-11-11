@extends('layout')

@section('title', 'Register')

@section('content')
    <section class="panel">
        <h1>Register</h1>
        <p class="sub">Your name is what appears on the leaderboard.</p>

        <form method="POST" action="{{ route('register') }}" class="form">
            @csrf
            <label>Name
                <input type="text" name="name" value="{{ old('name') }}" maxlength="30" required autofocus autocomplete="nickname">
                @error('name') <span class="error">{{ $message }}</span> @enderror
            </label>
            <label>Email
                <input type="email" name="email" value="{{ old('email') }}" required autocomplete="email">
                @error('email') <span class="error">{{ $message }}</span> @enderror
            </label>
            <label>Password
                <input type="password" name="password" required autocomplete="new-password">
                @error('password') <span class="error">{{ $message }}</span> @enderror
            </label>
            <label>Confirm password
                <input type="password" name="password_confirmation" required autocomplete="new-password">
            </label>
            <button type="submit" class="btn">Create account</button>
        </form>

        <p class="sub">Already registered? <a href="{{ route('login') }}">Log in</a></p>
    </section>
@endsection
