// c:\Users\BT\Desktop\Venv\zOther\Ebirr_Chrome_Verifier\services\sound_service.js
export function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = 880; // A5
        gain.gain.value = 0.1;
        osc.start();
        setTimeout(() => { osc.stop(); }, 200); // Short beep
    } catch (e) {
        console.error("Audio play failed", e);
    }
}

export function playTransactionSound(type) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        
        const now = ctx.currentTime;
        if (type === 'success') {
            // Cha-Ching! (Coin sound)
            const osc1 = ctx.createOscillator();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(1200, now);
            osc1.frequency.exponentialRampToValueAtTime(2000, now + 0.1);
            osc1.connect(gain);
            osc1.start(now);
            osc1.stop(now + 0.4);

            const osc2 = ctx.createOscillator();
            osc2.type = 'square';
            osc2.frequency.setValueAtTime(2000, now + 0.05);
            osc2.frequency.exponentialRampToValueAtTime(3000, now + 0.2);
            osc2.connect(gain);
            osc2.start(now + 0.05);
            osc2.stop(now + 0.4);

            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        } else if (type === 'error') {
            // Stronger Error (Sawtooth Buzz)
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(50, now + 0.3);
            osc.connect(gain);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'pdf' || type === 'random') {
            // PDF/Random Skip - Soft "Whoosh" (Sine Drop)
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(200, now + 0.15);
            osc.connect(gain);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
        }
    } catch (e) {
        console.error("Sound error", e);
    }
}
