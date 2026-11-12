<?php

namespace App\Http\Controllers;

use App\Models\Score;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Illuminate\View\View;
use Laravel\Socialite\Facades\Socialite;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirectResponse;
use Throwable;

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

        if ($user !== null && ! $user->signsInWithEmailOnly()) {
            return back()
                ->withErrors(['email' => $this->howToSignIn($user)])
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

        if ($user?->signsInWithEmailOnly()) {
            Auth::login($user, $remember);
        } elseif ($user !== null && $user->password === null) {
            return back()
                ->withErrors(['email' => $this->howToSignIn($user)])
                ->onlyInput('email');
        } elseif (! Auth::attempt(['email' => $credentials['email'], 'password' => $credentials['password'] ?? ''], $remember)) {
            return back()
                ->withErrors(['email' => 'Those details don\'t match an account.'])
                ->onlyInput('email');
        }

        $request->session()->regenerate();

        return $this->welcome($request->user());
    }

    /**
     * Send the visitor to Google to sign in.
     */
    public function redirectToGoogle(): SymfonyRedirectResponse
    {
        abort_unless(self::googleEnabled(), 404);

        return Socialite::driver('google')->redirect();
    }

    /**
     * Sign in the Google account that came back, creating or linking a player.
     */
    public function handleGoogleCallback(Request $request): RedirectResponse
    {
        abort_unless(self::googleEnabled(), 404);

        try {
            $googleUser = Socialite::driver('google')->user();
        } catch (Throwable) {
            return redirect()->route('login')
                ->withErrors(['email' => 'Google sign-in did not complete. Please try again.']);
        }

        $email = Str::lower((string) $googleUser->getEmail());

        if ($email === '') {
            return redirect()->route('login')
                ->withErrors(['email' => 'Google did not share an email address, so no account could be made.']);
        }

        // Google has verified the address, so an existing account with the
        // same email is the same person and gets linked.
        $user = User::query()->where('google_id', $googleUser->getId())->first()
            ?? User::query()->where('email', $email)->first();

        if ($user === null) {
            $user = User::create(['name' => User::generateName(), 'email' => $email, 'google_id' => $googleUser->getId()]);
        } elseif ($user->google_id === null) {
            $user->update(['google_id' => $googleUser->getId()]);
        }

        Auth::login($user, remember: true);
        $request->session()->regenerate();

        return $this->welcome($user);
    }

    public static function googleEnabled(): bool
    {
        return filled(config('services.google.client_id')) && filled(config('services.google.client_secret'));
    }

    public function logout(Request $request): RedirectResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('game');
    }

    private function howToSignIn(User $user): string
    {
        return $user->password !== null
            ? 'That email already has an account with a password. Log in with it instead.'
            : 'That email is linked to a Google account. Use "Continue with Google" instead.';
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
