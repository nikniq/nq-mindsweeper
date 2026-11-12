// Music and sound effects, synthesised with the Web Audio API so there are
// no audio files to load. Exposes window.GameAudio.
window.GameAudio = (() => {
    'use strict';

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const MUSIC_LEVEL = 0.5, SFX_LEVEL = 0.55;
    const STEP = 60 / 76 / 2; // one eighth note at 76 bpm, in seconds
    const STEPS_PER_BAR = 8;

    // One bar each: a bass note and the chord tones the melody wanders over (MIDI).
    const BARS = [
        { bass: 45, tones: [57, 60, 64, 67, 71, 72, 76] }, // Am9
        { bass: 41, tones: [57, 60, 64, 65, 69, 72, 77] }, // Fmaj7
        { bass: 48, tones: [55, 60, 64, 67, 71, 72, 76] }, // Cmaj7
        { bass: 43, tones: [55, 59, 62, 64, 67, 71, 74] }, // G6
    ];

    function pref(key) {
        try { return localStorage.getItem(key) !== '0'; } catch (e) { return true; }
    }
    function storePref(key, on) {
        try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* ignore */ }
    }

    let musicOn = pref('music'), soundOn = pref('sound');
    let ctx = null, musicBus, sfxBus, echo, noise;
    let scheduler = null, nextTime = 0, step = 0, melodyIdx = 3;
    const lastPlayed = {};

    const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

    function ensure() {
        if (ctx) return true;
        if (!AudioCtx) return false;
        ctx = new AudioCtx();

        const limiter = ctx.createDynamicsCompressor();
        limiter.connect(ctx.destination);

        musicBus = ctx.createGain();
        musicBus.gain.value = 0;
        musicBus.connect(limiter);

        sfxBus = ctx.createGain();
        sfxBus.gain.value = SFX_LEVEL;
        sfxBus.connect(limiter);

        // A soft feedback echo that the melody is sent through.
        echo = ctx.createDelay(1);
        echo.delayTime.value = STEP * 1.5;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.35;
        const damp = ctx.createBiquadFilter();
        damp.type = 'lowpass';
        damp.frequency.value = 1800;
        echo.connect(damp).connect(feedback).connect(echo);
        damp.connect(musicBus);

        const length = ctx.sampleRate;
        noise = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

        return true;
    }

    // A single enveloped oscillator note.
    function tone(dest, freq, at, { dur = 0.3, gain = 0.2, type = 'sine', attack = 0.008, slideTo = null } = {}) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, at);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
        env.gain.setValueAtTime(0.0001, at);
        env.gain.linearRampToValueAtTime(gain, at + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        osc.connect(env).connect(dest);
        osc.start(at);
        osc.stop(at + dur + 0.05);
        return env;
    }

    function scheduleStep(at) {
        const bar = BARS[Math.floor(step / STEPS_PER_BAR) % BARS.length];
        const beat = step % STEPS_PER_BAR;
        const barLength = STEP * STEPS_PER_BAR;

        if (beat === 0) {
            tone(musicBus, hz(bar.bass), at, { dur: barLength * 0.95, gain: 0.22, attack: 0.04 });
            // Pad: the lower chord tones, swelling in and out over the bar.
            for (const midi of bar.tones.slice(0, 4)) {
                tone(musicBus, hz(midi), at, { dur: barLength * 1.1, gain: 0.035, type: 'triangle', attack: barLength * 0.4 });
            }
        }
        if (beat === 4) {
            tone(musicBus, hz(bar.bass + 12), at, { dur: STEP * 2, gain: 0.08, attack: 0.02 });
        }

        // Melody: a random walk over the chord tones, with some rests.
        if (Math.random() < (beat % 2 ? 0.55 : 0.85)) {
            melodyIdx += Math.floor(Math.random() * 5) - 2;
            melodyIdx = Math.max(0, Math.min(bar.tones.length - 1, melodyIdx));
            const env = tone(musicBus, hz(bar.tones[melodyIdx] + 12), at, { dur: STEP * 1.8, gain: 0.07, type: 'triangle' });
            env.connect(echo);
        }
        step++;
    }

    function pump() {
        if (!ctx || ctx.state !== 'running') return;
        if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
        while (nextTime < ctx.currentTime + 0.3) {
            scheduleStep(nextTime);
            nextTime += STEP;
        }
    }

    function startMusic() {
        if (!ensure()) return;
        ctx.resume();
        musicBus.gain.setTargetAtTime(MUSIC_LEVEL, ctx.currentTime, 0.6);
        if (!scheduler) scheduler = setInterval(pump, 100);
    }

    function stopMusic() {
        if (!ctx) return;
        clearInterval(scheduler);
        scheduler = null;
        musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    }

    // Browsers only allow audio after a user gesture, so call this from one.
    function unlock() {
        if (!musicOn && !soundOn) return;
        if (!ensure()) return;
        ctx.resume();
        if (musicOn) startMusic();
    }

    const effects = {
        // A pluck whose pitch climbs with the number that was uncovered.
        reveal(at, n = 0) {
            const scale = [60, 64, 67, 69, 72, 76, 79, 81, 84];
            tone(sfxBus, hz(scale[n] || 60), at, { dur: 0.16, gain: 0.22, type: 'triangle' });
        },
        // An empty area opening up.
        flood(at) {
            [60, 67, 72, 76].forEach((midi, k) => {
                tone(sfxBus, hz(midi), at + k * 0.045, { dur: 0.2, gain: 0.16, type: 'triangle' });
            });
        },
        flag(at) {
            tone(sfxBus, 660, at, { dur: 0.09, gain: 0.14, type: 'square', slideTo: 990 });
        },
        unflag(at) {
            tone(sfxBus, 660, at, { dur: 0.09, gain: 0.12, type: 'square', slideTo: 440 });
        },
        deny(at) {
            tone(sfxBus, 160, at, { dur: 0.12, gain: 0.2, type: 'triangle' });
        },
        win(at) {
            [72, 76, 79, 84, 88].forEach((midi, k) => {
                tone(sfxBus, hz(midi), at + k * 0.1, { dur: k === 4 ? 0.9 : 0.3, gain: 0.2, type: 'triangle' });
            });
            tone(sfxBus, hz(48), at + 0.4, { dur: 1, gain: 0.25, attack: 0.03 });
        },
        lose(at) {
            const src = ctx.createBufferSource();
            src.buffer = noise;
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(2400, at);
            filter.frequency.exponentialRampToValueAtTime(80, at + 0.7);
            const env = ctx.createGain();
            env.gain.setValueAtTime(0.7, at);
            env.gain.exponentialRampToValueAtTime(0.0001, at + 0.8);
            src.connect(filter).connect(env).connect(sfxBus);
            src.start(at);
            src.stop(at + 0.85);
            tone(sfxBus, 130, at, { dur: 0.7, gain: 0.6, slideTo: 36 });

            // Let the music drop away under the blast, then come back.
            if (musicOn) {
                musicBus.gain.cancelScheduledValues(at);
                musicBus.gain.setTargetAtTime(MUSIC_LEVEL * 0.2, at, 0.05);
                musicBus.gain.setTargetAtTime(MUSIC_LEVEL, at + 1.2, 0.8);
            }
        },
    };

    function play(name, arg) {
        if (!soundOn || !effects[name] || !ensure()) return;
        if (ctx.state !== 'running') ctx.resume();
        // Several cells can open in one move; don't stack identical sounds.
        const now = ctx.currentTime;
        if (now - (lastPlayed[name] ?? -1) < 0.04) return;
        lastPlayed[name] = now;
        effects[name](now, arg);
    }

    function setMusic(on) {
        musicOn = on;
        storePref('music', on);
        if (on) startMusic(); else stopMusic();
    }

    function setSound(on) {
        soundOn = on;
        storePref('sound', on);
        if (on) play('flag');
    }

    // Stay quiet while the tab is in the background.
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend();
        else if (musicOn || soundOn) ctx.resume();
    });

    return {
        supported: Boolean(AudioCtx),
        unlock,
        play,
        setMusic,
        setSound,
        get music() { return musicOn; },
        get sound() { return soundOn; },
    };
})();
