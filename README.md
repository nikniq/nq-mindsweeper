# Mindsweeper

A mine-clearing puzzle game built with Laravel. Anyone can play straight away; an account is only needed to put your name on the leaderboard.

## Features

- Three difficulties: Beginner (9×9, 10 mines), Intermediate (16×16, 40 mines), Expert (30×16, 99 mines)
- Safe first click, flagging (right-click or long-press), and clicking a satisfied number to clear around it
- Play as a guest with no sign-up
- Register / log in to appear on the leaderboard
- A win made as a guest is held in the session and saved to your account when you register or log in
- Leaderboard of each player's best time per difficulty

## Requirements

- PHP 8.3+
- Composer
- SQLite (the default database)

## Setup

```sh
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate
php artisan serve
```

Then open http://localhost:8000.

## Public directory

The web root is `public_html/` rather than Laravel's default `public/`. This is set in `bootstrap/app.php` with `usePublicPath()`. Point your web server's document root at `public_html/`.

The CSS and JavaScript are plain files in `public_html/css` and `public_html/js`, so there is no front-end build step.

## Project layout

| Path | Purpose |
| --- | --- |
| `routes/web.php` | All routes |
| `app/Http/Controllers/AuthController.php` | Register, log in, log out |
| `app/Http/Controllers/ScoreController.php` | Saving wins and the leaderboard |
| `app/Models/Score.php` | Scores and the difficulty presets |
| `resources/views/` | Blade templates |
| `public_html/js/game.js` | Game logic |
| `public_html/css/app.css` | Styles |

## Tests

```sh
php artisan test
```

## Known limitations

- Winning times are reported by the browser and are not verified on the server.
- There is no password reset or email verification.
