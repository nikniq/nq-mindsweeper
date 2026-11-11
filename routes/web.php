<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\ScoreController;
use App\Models\Score;
use Illuminate\Support\Facades\Route;

// Anyone can play; an account is only needed to appear on the leaderboard.
Route::view('/', 'game', ['difficulties' => Score::DIFFICULTIES])->name('game');
Route::get('/leaderboard', [ScoreController::class, 'index'])->name('leaderboard');
Route::post('/scores', [ScoreController::class, 'store'])->middleware('throttle:30,1')->name('scores.store');

Route::middleware('guest')->group(function () {
    Route::get('/register', [AuthController::class, 'showRegister'])->name('register');
    Route::get('/login', [AuthController::class, 'showLogin'])->name('login');

    Route::middleware('throttle:10,1')->group(function () {
        Route::post('/register', [AuthController::class, 'register']);
        Route::post('/login', [AuthController::class, 'login']);
    });
});

Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth')->name('logout');
