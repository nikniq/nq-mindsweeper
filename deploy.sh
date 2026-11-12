#!/usr/bin/env bash
# Production deploy for Mindsweeper. Run ON the server, from the app root:
#
#   ./deploy.sh            # pull + dependencies + migrate + rebuild caches
#   ./deploy.sh --check    # show what a deploy would change; changes nothing
#   ./deploy.sh --no-pull  # redo dependencies/migrate/caches on the current commit
#
# Pull-without-migrate is the classic cause of a 500 after a deploy, so
# this makes the full sequence one command and the steps can't drift apart.
# Locally, `./cx.sh 20` runs this over ssh and `./cx.sh 21` runs --check.
#
# What it does beyond the basics:
# - refuses to run twice at once, or over uncommitted edits to tracked files
# - when migrations are pending: snapshots a SQLite database first, and
#   puts the site in maintenance mode while they run
# - checks the things that most often break a fresh deploy (.env, APP_KEY,
#   writable storage) before touching anything
#
# First deploy on a new server: clone the repo, create .env from
# .env.example (APP_ENV=production, APP_DEBUG=false, APP_URL), run
# `composer install --no-dev` and `php artisan key:generate`, point the
# web server's document root at public_html/, then run this script.

set -euo pipefail
cd "$(dirname "$0")"

MODE="deploy"
PULL=1
for arg in "$@"; do
    case "$arg" in
        --check)   MODE="check" ;;
        --no-pull) PULL=0 ;;
        -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "✗ Unknown option: $arg (try --help)"; exit 2 ;;
    esac
done

KEEP_BACKUPS=10
BACKUP_DIR="storage/app/backups"
LOCK_DIR="storage/framework/deploy.lock"

step() { echo "→ $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

# Read one setting from .env, without quotes. Empty if unset or commented.
env_value() {
    grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true
}

# Path of the SQLite database file, or empty when another driver is in use.
sqlite_path() {
    [ "$(env_value DB_CONNECTION)" = "sqlite" ] || return 0
    local db
    db="$(env_value DB_DATABASE)"
    echo "${db:-database/database.sqlite}"
}

# True when there is something to migrate. A missing migrations table
# (first deploy) makes migrate:status fail, which also counts as pending.
migrations_pending() {
    local status
    status="$(php artisan migrate:status 2>&1)" || return 0
    grep -q "Pending" <<<"$status"
}

#---------------------------------------------------------------
# Preflight — nothing has been changed yet if any of these stop us.
#---------------------------------------------------------------
command -v php >/dev/null 2>&1 || fail "php is not on PATH."
command -v git >/dev/null 2>&1 || fail "git is not on PATH."
[ -f .env ] || fail "No .env here. Create it from .env.example and run 'php artisan key:generate' first."
[ -n "$(env_value APP_KEY)" ] || fail "APP_KEY is empty in .env. Run 'php artisan key:generate'."
for d in storage/logs storage/framework bootstrap/cache; do
    [ -w "$d" ] || fail "$d is not writable by $(whoami)."
done

# Only tracked files matter: a modified one makes the pull fail halfway.
DIRTY="$(git status --porcelain --untracked-files=no)"

if [ "$MODE" = "check" ]; then
    step "git fetch"
    git fetch --quiet
    echo "Current : $(git log --oneline -1)"
    INCOMING="$(git log --oneline HEAD..@{u} 2>/dev/null || true)"
    if [ -n "$INCOMING" ]; then
        echo "Incoming commits:"
        echo "$INCOMING" | sed 's/^/  /'
        echo "Files changed:"
        git diff --stat HEAD @{u} | sed 's/^/  /'
        git diff --quiet HEAD @{u} -- composer.lock || echo "• composer.lock changes — dependencies will be installed"
        git diff --quiet HEAD @{u} -- database/migrations || echo "• migrations change — the site goes into maintenance mode while they run"
    else
        echo "Nothing to pull — already up to date."
    fi
    if migrations_pending; then echo "• migrations are pending on the current commit"; fi
    [ -z "$DIRTY" ] || { echo "⚠ Tracked files have local edits; a deploy will refuse to run:"; echo "$DIRTY" | sed 's/^/  /'; }
    exit 0
fi

[ -z "$DIRTY" ] || fail "Tracked files have been edited on the server; commit or discard them first:
$DIRTY"

# One deploy at a time. mkdir is atomic, so it works as the lock.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    fail "Another deploy is running (or one crashed). If not, remove $LOCK_DIR and retry."
fi

WENT_DOWN=0
cleanup() {
    local code=$?
    rmdir "$LOCK_DIR" 2>/dev/null || true
    if [ "$code" -ne 0 ]; then
        echo
        echo "✗ Deploy FAILED (exit $code). Started from ${BEFORE:-unknown}."
        if [ "$WENT_DOWN" -eq 1 ]; then
            echo "  The site is still in maintenance mode. Fix the problem and re-run,"
            echo "  or bring it back with: php artisan up"
        fi
        [ -z "${BACKUP_FILE:-}" ] || echo "  Database snapshot from before the migration: $BACKUP_FILE"
    fi
}
trap cleanup EXIT

BEFORE="$(git rev-parse --short HEAD)"

#---------------------------------------------------------------
# Code and dependencies
#---------------------------------------------------------------
# Remember the lockfile before pulling, so we can tell whether
# dependencies actually moved.
LOCK_BEFORE=$(git rev-parse HEAD:composer.lock 2>/dev/null || echo none)
if [ "$PULL" -eq 1 ]; then
    step "git pull"
    git pull --ff-only
fi
LOCK_AFTER=$(git rev-parse HEAD:composer.lock 2>/dev/null || echo none)

if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ] || [ ! -f vendor/autoload.php ]; then
    if command -v composer >/dev/null 2>&1; then
        step "composer install"
        composer install --no-dev --optimize-autoloader --no-interaction
    elif [ ! -f vendor/autoload.php ]; then
        fail "vendor/ is missing and composer is not on PATH. Install dependencies, then re-run."
    else
        # Not fatal: the pull has already landed, and stopping here would leave
        # the tree un-migrated as well. Say so loudly instead.
        echo "⚠ composer.lock changed but composer is not on PATH."
        echo "  Install dependencies manually before trusting this deploy."
    fi
fi

#---------------------------------------------------------------
# Database
#---------------------------------------------------------------
# With SQLite the database is a file that git does not carry; migrate
# fails on a fresh server unless it exists.
DB_FILE="$(sqlite_path)"
if [ -n "$DB_FILE" ] && [ ! -f "$DB_FILE" ]; then
    step "create $DB_FILE"
    touch "$DB_FILE"
fi

# The config cache may predate this pull; clear it so migrate reads .env.
php artisan config:clear >/dev/null

if migrations_pending; then
    # Snapshot first: a SQLite migration that goes wrong has no undo.
    if [ -n "$DB_FILE" ] && [ -s "$DB_FILE" ]; then
        mkdir -p "$BACKUP_DIR"
        BACKUP_FILE="$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)-$BEFORE.sqlite"
        step "snapshot database → $BACKUP_FILE"
        if command -v sqlite3 >/dev/null 2>&1; then
            sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"   # consistent even mid-write
        else
            cp "$DB_FILE" "$BACKUP_FILE"
        fi
        # Keep only the newest few so backups cannot fill the disk quota.
        ls -1t "$BACKUP_DIR"/*.sqlite 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | while read -r old; do rm -f "$old"; done
    fi

    step "maintenance mode on"
    php artisan down --retry=30 >/dev/null
    WENT_DOWN=1

    step "migrate"
    php artisan migrate --force
else
    step "migrate: nothing pending"
fi

#---------------------------------------------------------------
# Caches, back up, verify
#---------------------------------------------------------------
step "cache config/routes/views"
php artisan optimize

if [ "$WENT_DOWN" -eq 1 ]; then
    step "maintenance mode off"
    php artisan up >/dev/null
    WENT_DOWN=0
fi

step "verify"
if migrations_pending; then
    fail "migrations are still pending"
fi
if [ "$(env_value APP_DEBUG)" = "true" ]; then
    echo "⚠ APP_DEBUG=true in .env — turn it off in production."
fi
if [ "$(env_value APP_ENV)" != "production" ]; then
    echo "⚠ APP_ENV is '$(env_value APP_ENV)', not 'production'."
fi

AFTER="$(git rev-parse --short HEAD)"
echo
if [ "$BEFORE" = "$AFTER" ]; then
    echo "✓ already on $(git log --oneline -1) — caches rebuilt"
else
    echo "✓ deployed $BEFORE → $AFTER"
    git log --oneline "$BEFORE..$AFTER" | sed 's/^/  /'
    echo "  To go back: git reset --hard $BEFORE && ./deploy.sh --no-pull"
    echo "  (migrations are not reversed by that; restore a snapshot if needed)"
fi
