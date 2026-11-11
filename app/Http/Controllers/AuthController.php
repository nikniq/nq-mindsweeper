<?php

namespace App\Http\Controllers;

use App\Models\Score;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rules\Password;
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
            'name' => ['required', 'string', 'max:30', 'unique:users,name'],
            'email' => ['required', 'string', 'lowercase', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', Password::defaults()],
        ]);

        $user = User::create($data);

        Auth::login($user);
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
            'password' => ['required', 'string'],
        ]);

        if (! Auth::attempt($credentials, $request->boolean('remember'))) {
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
                ->with('status', 'Your time is on the leaderboard, '.$user->name.'.');
        }

        return redirect()->route('game');
    }
}
