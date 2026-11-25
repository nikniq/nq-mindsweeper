<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class NikniqAuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_nikniq_sign_in_is_off_until_configured(): void
    {
        $this->get('/')->assertOk();
        $this->get('/login')->assertDontSee('Continue with nikniq.com');
        $this->get('/auth/nikniq')->assertNotFound();
    }

    public function test_redirect_uses_pkce_and_the_configured_callback(): void
    {
        $this->enableNikniq(secret: null);

        $location = $this->get('/auth/nikniq')->assertRedirectContains('https://nikniq.test/sso/authorize?')->headers->get('Location');
        parse_str((string) parse_url($location, PHP_URL_QUERY), $query);

        $this->assertSame('cid', $query['client_id']);
        $this->assertSame('S256', $query['code_challenge_method']);
        $this->assertSame('http://localhost/auth/nikniq/callback', $query['redirect_uri']);
        $this->assertSame(session('nikniq_state'), $query['state']);
        $this->assertArrayNotHasKey('prompt', $query);
    }

    public function test_sign_in_button_is_offered_when_configured(): void
    {
        $this->enableNikniq();

        $this->withSession(['nikniq_checked' => now()->timestamp])
            ->get('/login')->assertSee('Continue with nikniq.com');
    }

    public function test_new_portal_player_gets_an_account_with_their_name_and_a_saved_guest_win(): void
    {
        $this->enableNikniq(secret: null);
        Http::fake(['nikniq.test/api/sso/token' => Http::response(['player' => ['id' => 7, 'name' => 'Ace Player', 'email' => 'Ace@Example.com']], 201)]);
        $this->postJson('/scores', ['difficulty' => 'beginner', 'time_ms' => 9000])->assertStatus(202);

        $this->get('/auth/nikniq');
        $this->get('/auth/nikniq/callback?code=abc&state='.session('nikniq_state'))->assertRedirect('/leaderboard');

        $user = User::query()->where('nikniq_id', '7')->sole();
        $this->assertAuthenticatedAs($user);
        $this->assertSame(['Ace Player', 'ace@example.com'], [$user->name, $user->email]);
        $this->assertDatabaseHas('scores', ['user_id' => $user->id, 'time_ms' => 9000]);
        Http::assertSent(fn ($request) => $request['code'] === 'abc'
            && strlen($request['code_verifier']) === 64
            && ! isset($request['client_secret']));
    }

    public function test_portal_name_that_is_already_taken_is_replaced(): void
    {
        $this->enableNikniq();
        User::factory()->create(['name' => 'Ace Player']);
        Http::fake(['nikniq.test/api/sso/token' => Http::response(['player' => ['id' => 7, 'name' => 'Ace Player', 'email' => 'new@example.com']])]);

        $this->get('/auth/nikniq');
        $this->get('/auth/nikniq/callback?code=abc&state='.session('nikniq_state'));

        $this->assertNotSame('Ace Player', User::query()->where('nikniq_id', '7')->value('name'));
    }

    public function test_existing_account_is_linked_and_then_needs_nikniq(): void
    {
        $this->enableNikniq();
        Http::fake(['nikniq.test/api/sso/token' => Http::response(['player' => ['id' => 42, 'name' => 'Ace', 'email' => 'ace@example.com']])]);
        $user = User::factory()->create(['email' => 'ace@example.com', 'password' => null]);

        $this->get('/auth/nikniq');
        $this->get('/auth/nikniq/callback?code=abc&state='.session('nikniq_state'))->assertRedirect('/');

        $this->assertAuthenticatedAs($user);
        $this->assertSame('42', $user->refresh()->nikniq_id);
        Http::assertSent(fn ($request) => $request['client_secret'] === 'secret');

        $this->post('/logout');
        $this->post('/login', ['email' => 'ace@example.com'])->assertSessionHasErrors('email');
        $this->assertGuest();
    }

    public function test_tampered_state_and_failed_exchange_are_refused(): void
    {
        $this->enableNikniq();
        Http::fake(['nikniq.test/api/sso/token' => Http::response(['error' => 'invalid_grant'], 400)]);

        $this->get('/auth/nikniq');
        $this->get('/auth/nikniq/callback?code=abc&state=wrong')->assertRedirect('/login')->assertSessionHasErrors('email');

        $this->get('/auth/nikniq');
        $this->get('/auth/nikniq/callback?code=abc&state='.session('nikniq_state'))->assertRedirect('/login')->assertSessionHasErrors('email');

        $this->assertGuest();
        $this->assertDatabaseCount('users', 0);
    }

    public function test_guest_is_silently_checked_then_rechecked_later(): void
    {
        $this->enableNikniq();

        $this->get('/leaderboard')->assertRedirect(route('nikniq.redirect', ['silent' => 1]));
        $this->get('/auth/nikniq?silent=1')->assertRedirectContains('prompt=none');
        $this->get('/auth/nikniq/callback?error=login_required&state='.session('nikniq_state'))->assertRedirect(url('/leaderboard'));

        $this->assertGuest();
        $this->get('/leaderboard')->assertOk();

        $this->travel(3)->minutes();
        $this->get('/leaderboard')->assertRedirect(route('nikniq.redirect', ['silent' => 1]));
    }

    public function test_bots_and_players_who_logged_out_are_not_redirected(): void
    {
        $this->enableNikniq();

        $this->withHeader('User-Agent', 'Googlebot/2.1')->get('/')->assertOk();

        $this->actingAs(User::factory()->create())->post('/logout');
        $this->withHeader('User-Agent', 'Mozilla/5.0')->get('/')->assertOk();
    }

    private function enableNikniq(?string $secret = 'secret'): void
    {
        config([
            'services.nikniq.url' => 'https://nikniq.test',
            'services.nikniq.client_id' => 'cid',
            'services.nikniq.client_secret' => $secret,
            'services.nikniq.redirect' => 'http://localhost/auth/nikniq/callback',
        ]);
    }
}
