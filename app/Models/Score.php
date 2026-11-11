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
    ];

    /** Session key holding a guest's best unsaved time per difficulty. */
    public const PENDING_KEY = 'pending_scores';

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Move any wins the visitor made as a guest onto their account.
     */
    public static function claimPending(User $user): int
    {
        $pending = session()->pull(self::PENDING_KEY, []);

        foreach ($pending as $difficulty => $timeMs) {
            if (isset(self::DIFFICULTIES[$difficulty])) {
                $user->scores()->create(['difficulty' => $difficulty, 'time_ms' => (int) $timeMs]);
            }
        }

        return count($pending);
    }
}
