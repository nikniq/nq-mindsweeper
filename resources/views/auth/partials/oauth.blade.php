@php
    $nikniq = \App\Http\Controllers\NikniqController::enabled();
    $google = \App\Http\Controllers\AuthController::googleEnabled();
@endphp
@if ($nikniq || $google)
    <div class="oauth">
        @if ($nikniq)
            <a class="btn btn-oauth btn-nikniq" href="{{ route('nikniq.redirect') }}"><span class="nq-logo" aria-hidden="true">nq</span> Continue with nikniq.com</a>
        @endif
        @if ($google)
            <a class="btn btn-oauth google" href="{{ route('google.redirect') }}">Continue with Google</a>
        @endif
        <p class="or"><span>or use email</span></p>
    </div>
@endif
