<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Arr;

#[Fillable(['name', 'email', 'password', 'google_id'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /**
     * Whether knowing the email address is enough to sign in. True only for
     * accounts registered with just an email: no password and no Google link.
     */
    public function signsInWithEmailOnly(): bool
    {
        return $this->password === null && $this->google_id === null;
    }

    /**
     * Pick an unused leaderboard name, such as "Swift Otter", for a player
     * who registered with only an email address.
     */
    public static function generateName(): string
    {
        $adjectives = ['Swift', 'Calm', 'Bold', 'Lucky', 'Clever', 'Quiet', 'Brave', 'Steady', 'Sharp', 'Nimble', 'Sly', 'Keen'];
        $animals = ['Otter', 'Fox', 'Owl', 'Lynx', 'Heron', 'Badger', 'Wren', 'Hare', 'Mole', 'Raven', 'Stoat', 'Finch'];

        $base = Arr::random($adjectives).' '.Arr::random($animals);
        $name = $base;

        while (self::query()->where('name', $name)->exists()) {
            $name = $base.' '.random_int(2, 9999);
        }

        return $name;
    }

    public function scores(): HasMany
    {
        return $this->hasMany(Score::class);
    }
}
