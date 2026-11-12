# Mindsweeper

A mine-clearing puzzle game built with Laravel. Anyone can play straight away; an account is only needed to put your name on the leaderboard.

## Features

- Three difficulties: Beginner (9×9, 10 mines), Intermediate (16×16, 40 mines), Expert (30×16, 99 mines)
- Safe first click, flagging (right-click or long-press), and clicking a satisfied number to clear around it
- Play as a guest with no sign-up
- Register with just an email address to appear on the leaderboard under a generated nickname
- A win made as a guest is held in the session and saved to your account when you register or log in
- Leaderboard of each player's best time per difficulty
- Daily board: the same mines for everyone each day (UTC), started from a marked cell, with its own leaderboard. Only a first attempt counts; replays are practice
- Hints: shows a move the visible numbers prove (or a safe cell when they prove nothing), adding 10 seconds each time
- After a win: the board's 3BV, clicks used and efficiency
- No-guessing boards: an optional mode where every board can be cleared by deduction alone (unranked)
- Daily streak and a countdown to the next daily board; confetti on a win
- Custom boards of your own width, height and mine count (unranked)
- A saved win tells you your leaderboard position, and you can change your leaderboard name on the leaderboard page
- Flag mode for touch screens, keyboard play, local stats (best time, win rate, streak), generated music and sound effects

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

## Deployment and maintenance

Two scripts cover routine server work:

- `deploy.sh` runs **on the server** from the app root. It pulls, installs Composer dependencies when `composer.lock` has changed, migrates, and rebuilds the caches. When migrations are pending it first snapshots the SQLite database to `storage/app/backups/` (newest ten kept) and puts the site in maintenance mode while they run. `./deploy.sh --check` shows what a deploy would change without changing anything.
- `cx.sh` runs **on your local machine**. It is a menu of maintenance tasks carried out over SSH: deploy and deploy preview, compare the server with local, migration status, caches, health check, logs, artisan commands, permissions, maintenance mode, and downloading the database. Run `./cx.sh` for the menu, `./cx.sh -h` to list the options, or `./cx.sh 20` to run one directly.

`cx.sh` is configured in the Settings block at the top of the file: set `PROJECT`, `REMOTE_USER` and `REMOTE_HOST` (and `REMOTE_PORT` if it is not 22). Any setting can instead be passed in the environment for a single run, which keeps host details out of the repo:

```sh
REMOTE_HOST=box.example.com REMOTE_USER=me PROJECT=example.com ./cx.sh 22
```

For a first deploy, clone the repo on the server, create `.env` from `.env.example` (with `APP_ENV=production` and `APP_DEBUG=false`), run `php artisan key:generate`, point the document root at `public_html/`, then run `./deploy.sh`.

## Google sign-in

"Continue with Google" appears on the log in and register pages once credentials are set:

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**.
2. Add `https://your-domain/auth/google/callback` as an **Authorised redirect URI** (and `http://localhost:8000/auth/google/callback` for local use).
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, check `APP_URL` is the site's real address, then run `php artisan config:cache` (a deploy does this).

A Google sign-in with the same email as an existing account is linked to that account, which from then on can only be entered through Google or its password.

## Known limitations

- Winning times are reported by the browser and are not verified on the server.
- Registration asks only for an email address, which is not verified, so anyone who knows the address of an email-only account can log in as it. Accounts with a password or a Google link are not affected.
- There is no password reset.
