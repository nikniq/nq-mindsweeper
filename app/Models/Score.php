<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'difficulty', 'time_ms'])]
class Score extends Model
{
    /** Board presets, shared with the front end. */
    public const DIFFICULTIES = [
        'beginner' => ['label' => 'Beginner', 'cols' => 9, 'rows' => 9, 'mines' => 10],
        'intermediate' => ['label' => 'Intermediate', 'cols' => 16, 'rows' => 16, 'mines' => 40],
        'expert' => ['label' => 'Expert', 'cols' => 30, 'rows' => 16, 'mines' => 99],
        self::DAILY => ['label' => 'Daily', 'cols' => 16, 'rows' => 16, 'mines' => 40],
    ];

    /** The board that is the same for every player and changes each day. */
    public const DAILY = 'daily';

    /** Session key holding the day a guest's unsaved daily time was set on. */
    public const PENDING_DAY_KEY = 'pending_daily_day';

    /** Session key holding a guest's best unsaved time per difficulty. */
    public const PENDING_KEY = 'pending_scores';

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The day (UTC) that identifies the current daily board.
     */
    public static function today(): string
    {
        return now()->toDateString();
    }

    /**
     * Only a player's first time on each daily board counts.
     */
    public static function hasDailyTimeToday(User $user): bool
    {
        return $user->scores()
            ->where('difficulty', self::DAILY)
            ->where('created_at', '>=', now()->startOfDay())
            ->exists();
    }

    /**
     * The player's position on a difficulty's leaderboard, or null when they
     * have no time on it. Players are ordered by their best time; the daily
     * board only looks at today.
     */
    public static function rankFor(User $user, string $difficulty): ?int
    {
        $onBoard = fn () => self::query()
            ->where('difficulty', $difficulty)
            ->when($difficulty === self::DAILY, fn ($query) => $query->where('created_at', '>=', now()->startOfDay()));

        $best = $onBoard()->where('user_id', $user->id)->min('time_ms');

        if ($best === null) {
            return null;
        }

        return $onBoard()->where('time_ms', '<', $best)->distinct()->count('user_id') + 1;
    }

    /**
     * Move any wins the visitor made as a guest onto their account.
     */
    public static function claimPending(User $user): int
    {
        $pending = session()->pull(self::PENDING_KEY, []);
        $pendingDay = session()->pull(self::PENDING_DAY_KEY);
        $claimed = 0;

        foreach ($pending as $difficulty => $timeMs) {
            if (! isset(self::DIFFICULTIES[$difficulty])) {
                continue;
            }

            // A daily time is only worth keeping for the board it was set on.
            if ($difficulty === self::DAILY && ($pendingDay !== self::today() || self::hasDailyTimeToday($user))) {
                continue;
            }

            $user->scores()->create(['difficulty' => $difficulty, 'time_ms' => (int) $timeMs]);
            $claimed++;
        }

        return $claimed;
    }
}
