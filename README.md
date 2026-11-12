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

## Deployment and maintenance

Two scripts cover routine server work:

- `deploy.sh` runs **on the server** from the app root. It pulls, installs Composer dependencies when `composer.lock` has changed, migrates, and rebuilds the caches. When migrations are pending it first snapshots the SQLite database to `storage/app/backups/` (newest ten kept) and puts the site in maintenance mode while they run. `./deploy.sh --check` shows what a deploy would change without changing anything.
- `cx.sh` runs **on your local machine**. It is a menu of maintenance tasks carried out over SSH: deploy and deploy preview, compare the server with local, migration status, caches, health check, logs, artisan commands, permissions, maintenance mode, and downloading the database. Run `./cx.sh` for the menu, `./cx.sh -h` to list the options, or `./cx.sh 20` to run one directly.

`cx.sh` reads its host and account settings from `vars.sh`, which is gitignored:

```sh
cp vars.sh.example vars.sh   # then fill in the host, user and paths
```

For a first deploy, clone the repo on the server, create `.env` from `.env.example` (with `APP_ENV=production` and `APP_DEBUG=false`), run `php artisan key:generate`, point the document root at `public_html/`, then run `./deploy.sh`.

## Known limitations

- Winning times are reported by the browser and are not verified on the server.
- There is no password reset or email verification.
