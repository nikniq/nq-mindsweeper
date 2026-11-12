<?php

namespace Tests\Feature;

use App\Models\Score;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ExampleTest extends TestCase
{
    use RefreshDatabase;

    public function test_public_directory_is_public_html(): void
    {
        $this->assertSame(base_path('public_html'), public_path());
    }

    public function test_guests_can_open_the_game_and_leaderboard(): void
    {
        $this->get('/')->assertOk()->assertSee('New game');
        $this->get('/leaderboard')->assertOk()->assertSee('No times yet');
    }

    public function test_guest_win_is_held_then_saved_on_registration(): void
    {
        $this->postJson('/scores', ['difficulty' => 'beginner', 'time_ms' => 9000])
            ->assertStatus(202)->assertJson(['saved' => false]);
        $this->postJson('/scores', ['difficulty' => 'beginner', 'time_ms' => 7000])->assertStatus(202);
        $this->assertDatabaseCount('scores', 0);

        $this->post('/register', ['email' => 'ada@example.com'])->assertRedirect('/leaderboard');

        $this->assertAuthenticated();
        $this->assertDatabaseCount('scores', 1);
        $this->assertDatabaseHas('scores', ['difficulty' => 'beginner', 'time_ms' => 7000]);
        $name = User::query()->where('email', 'ada@example.com')->value('name');
        $this->get('/leaderboard')->assertSee($name)->assertSee('7.00s')->assertDontSee('ada@');
    }

    public function test_email_only_account_logs_in_with_just_its_email(): void
    {
        $this->post('/register', ['email' => 'ada@example.com'])->assertRedirect('/');
        $user = User::query()->where('email', 'ada@example.com')->sole();
        $this->assertNull($user->password);
        $this->post('/logout');

        $this->post('/login', ['email' => 'ada@example.com'])->assertRedirect('/');
        $this->assertAuthenticatedAs($user);
    }

    public function test_registering_an_email_only_address_again_signs_into_the_same_account(): void
    {
        $user = User::factory()->create(['password' => null]);

        $this->post('/register', ['email' => $user->email])->assertRedirect('/');

        $this->assertAuthenticatedAs($user);
        $this->assertDatabaseCount('users', 1);
    }

    public function test_account_with_a_password_cannot_be_entered_with_only_its_email(): void
    {
        $user = User::factory()->create();

        $this->post('/register', ['email' => $user->email])->assertSessionHasErrors('email');
        $this->post('/login', ['email' => $user->email])->assertSessionHasErrors('email');

        $this->assertGuest();
    }

    public function test_guest_win_is_saved_on_login(): void
    {
        $user = User::factory()->create();

        $this->postJson('/scores', ['difficulty' => 'expert', 'time_ms' => 120000])->assertStatus(202);
        $this->post('/login', ['email' => $user->email, 'password' => 'password'])
            ->assertRedirect('/leaderboard');

        $this->assertDatabaseHas('scores', ['user_id' => $user->id, 'difficulty' => 'expert']);
    }

    public function test_signed_in_win_is_saved_immediately(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/scores', ['difficulty' => 'intermediate', 'time_ms' => 45000])
            ->assertCreated()->assertJson(['saved' => true]);

        $this->assertDatabaseHas('scores', ['user_id' => $user->id, 'time_ms' => 45000]);
    }

    public function test_leaderboard_shows_each_players_best_time_in_order(): void
    {
        $slow = User::factory()->create(['name' => 'Slowpoke']);
        $fast = User::factory()->create(['name' => 'Quick']);
        $slow->scores()->createMany([
            ['difficulty' => 'beginner', 'time_ms' => 30000],
            ['difficulty' => 'beginner', 'time_ms' => 20000],
        ]);
        $fast->scores()->create(['difficulty' => 'beginner', 'time_ms' => 8000]);

        $this->get('/leaderboard')
            ->assertSeeInOrder(['Quick', '8.00s', 'Slowpoke', '20.00s'])
            ->assertDontSee('30.00s');
    }

    public function test_invalid_scores_and_bad_logins_are_rejected(): void
    {
        $this->postJson('/scores', ['difficulty' => 'godmode', 'time_ms' => 0])
            ->assertUnprocessable()->assertJsonValidationErrors(['difficulty', 'time_ms']);

        $user = User::factory()->create();
        $this->post('/login', ['email' => $user->email, 'password' => 'nope'])
            ->assertSessionHasErrors('email');
        $this->assertGuest();
        $this->assertSame(0, Score::count());
    }
}
