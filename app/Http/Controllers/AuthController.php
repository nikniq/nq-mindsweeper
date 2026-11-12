<?php

namespace App\Http\Controllers;

use App\Models\Score;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;

class AuthController extends Controller
{
    public function showRegister(): View
    {
        return view('auth.register');
    }

    public function register(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'lowercase', 'email', 'max:255'],
        ]);

        $user = User::query()->where('email', $data['email'])->first();

        if ($user?->password !== null) {
            return back()
                ->withErrors(['email' => 'That email already has an account with a password. Log in instead.'])
                ->onlyInput('email');
        }

        $user ??= User::create(['name' => User::generateName(), 'email' => $data['email']]);

        Auth::login($user, remember: true);
        $request->session()->regenerate();

        return $this->welcome($user);
    }

    public function showLogin(): View
    {
        return view('auth.login');
    }

    public function login(Request $request): RedirectResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'string', 'email'],
            'password' => ['nullable', 'string'],
        ]);

        $remember = $request->boolean('remember');
        $user = User::query()->where('email', $credentials['email'])->first();

        if ($user !== null && $user->password === null) {
            Auth::login($user, $remember);
        } elseif (! Auth::attempt(['email' => $credentials['email'], 'password' => $credentials['password'] ?? ''], $remember)) {
            return back()
                ->withErrors(['email' => 'Those details don\'t match an account.'])
                ->onlyInput('email');
        }

        $request->session()->regenerate();

        return $this->welcome($request->user());
    }

    public function logout(Request $request): RedirectResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('game');
    }

    /**
     * Save any wins made as a guest, then send the player where it makes sense.
     */
    private function welcome(User $user): RedirectResponse
    {
        if (Score::claimPending($user) > 0) {
            return redirect()->route('leaderboard')
                ->with('status', 'Your time is on the leaderboard as '.$user->name.'.');
        }

        return redirect()->route('game')
            ->with('status', 'You are playing as '.$user->name.'.');
    }
}
