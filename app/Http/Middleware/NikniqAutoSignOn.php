<?php

namespace App\Http\Middleware;

use App\Http\Controllers\NikniqController;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A guest's page view takes a silent detour through nikniq.com (at most every
 * RECHECK_SECONDS): if they are logged in there, they come back signed in.
 * Players who log out here are left alone for the rest of their session.
 */
class NikniqAutoSignOn
{
    private const RECHECK_SECONDS = 120;

    private const SKIP = ['auth/*', 'login', 'register', 'logout', 'scores', 'name', 'up', 'robots.txt', 'favicon.ico'];

    public function handle(Request $request, Closure $next): Response
    {
        if (NikniqController::enabled()
            && $request->isMethod('GET')
            && ! $request->user()
            && ! $request->ajax() && ! $request->expectsJson() && ! $request->prefetch()
            && ! $request->session()->get('nikniq_optout')
            && now()->timestamp - (int) $request->session()->get('nikniq_checked', 0) >= self::RECHECK_SECONDS
            && ! $request->is(...self::SKIP)
            && ! preg_match('/bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget|lighthouse/i', (string) $request->userAgent())) {
            $request->session()->put('nikniq_checked', now()->timestamp);
            $request->session()->put('url.intended', $request->fullUrl());

            return redirect()->route('nikniq.redirect', ['silent' => 1]);
        }

        return $next($request);
    }
}
