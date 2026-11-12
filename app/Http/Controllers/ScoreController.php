<?php

namespace App\Http\Controllers;

use App\Models\Score;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\View\View;

class ScoreController extends Controller
{
    public function index(Request $request): View
    {
        $difficulty = $request->query('difficulty');
        if (! isset(Score::DIFFICULTIES[$difficulty])) {
            $difficulty = 'beginner';
        }

        // Each player's best time for the chosen difficulty.
        $rows = Score::query()
            ->join('users', 'users.id', '=', 'scores.user_id')
            ->where('scores.difficulty', $difficulty)
            ->when($difficulty === Score::DAILY, fn ($query) => $query->where('scores.created_at', '>=', now()->startOfDay()))
            ->groupBy('users.id', 'users.name')
            ->selectRaw('users.id as user_id, users.name, MIN(scores.time_ms) as best_ms, COUNT(*) as wins')
            ->orderBy('best_ms')
            ->limit(25)
            ->toBase()
            ->get();

        return view('leaderboard', [
            'difficulty' => $difficulty,
            'rows' => $rows,
            'day' => Score::today(),
        ]);
    }

    /**
     * Record a win. Signed-in players are saved straight away; guests have
     * their best time held in the session until they register or log in.
     * The daily board only counts once per player, on the day it was set.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'difficulty' => ['required', Rule::in(array_keys(Score::DIFFICULTIES))],
            'time_ms' => ['required', 'integer', 'min:1', 'max:86400000'],
            'day' => ['nullable', 'date_format:Y-m-d'],
        ]);

        $isDaily = $data['difficulty'] === Score::DAILY;
        $score = ['difficulty' => $data['difficulty'], 'time_ms' => $data['time_ms']];

        if ($isDaily && ($data['day'] ?? null) !== Score::today()) {
            return response()->json(['saved' => false, 'reason' => 'stale'], 409);
        }

        if ($user = $request->user()) {
            if ($isDaily && Score::hasDailyTimeToday($user)) {
                return response()->json(['saved' => false, 'reason' => 'played']);
            }

            $user->scores()->create($score);

            return response()->json(['saved' => true], 201);
        }

        $pending = $request->session()->get(Score::PENDING_KEY, []);
        $best = $pending[$data['difficulty']] ?? null;

        if ($isDaily) {
            // Keep the first time set on today's board, not the fastest.
            if ($best !== null && $request->session()->get(Score::PENDING_DAY_KEY) === Score::today()) {
                return response()->json(['saved' => false, 'reason' => 'played']);
            }

            $best = null;
            $request->session()->put(Score::PENDING_DAY_KEY, Score::today());
        }

        if ($best === null || $data['time_ms'] < $best) {
            $pending[$data['difficulty']] = $data['time_ms'];
            $request->session()->put(Score::PENDING_KEY, $pending);
        }

        return response()->json(['saved' => false], 202);
    }
}
