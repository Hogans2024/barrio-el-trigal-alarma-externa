/**
 * Web Audio API synthesizer for the community alarm siren.
 * Operates client-side programmatically to play a dual-sweep alarm.
 */

let audioCtx: AudioContext | null = null;
let oscillator1: OscillatorNode | null = null;
let oscillator2: OscillatorNode | null = null;
let gainNode: GainNode | null = null;
let modulationOsc: OscillatorNode | null = null;

export const startSiren = () => {
  try {
    // Initialize AudioContext safely
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    // Stop existing nodes if any are active
    stopSiren();

    // Create Nodes
    oscillator1 = audioCtx.createOscillator();
    oscillator2 = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();
    modulationOsc = audioCtx.createOscillator();

    // Configure main oscillators
    oscillator1.type = 'sawtooth';
    oscillator2.type = 'square';

    // Slight detune for a richer, more alarming sound
    oscillator1.frequency.value = 850;
    oscillator2.frequency.value = 855;

    // Siren modulation (creates the "wah-wah" sweep effect)
    modulationOsc.frequency.value = 2.5; // 2.5Hz sweep cycle
    const modulationGain = audioCtx.createGain();
    modulationGain.gain.value = 150; // Pitch sweep range +/- 150Hz

    // Connect modulation to frequencies
    modulationOsc.connect(modulationGain);
    modulationGain.connect(oscillator1.frequency);
    modulationGain.connect(oscillator2.frequency);

    // Set volumes
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    // Smooth ramp-up to avoid clicks
    gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.5);

    // Connect audio signal chain
    oscillator1.connect(gainNode);
    oscillator2.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Start playback
    oscillator1.start();
    oscillator2.start();
    modulationOsc.start();
  } catch (error) {
    console.warn('Web Audio API not supported or blocked by browser policies:', error);
  }
};

export const stopSiren = () => {
  try {
    if (oscillator1) {
      oscillator1.stop();
      oscillator1.disconnect();
      oscillator1 = null;
    }
    if (oscillator2) {
      oscillator2.stop();
      oscillator2.disconnect();
      oscillator2 = null;
    }
    if (modulationOsc) {
      modulationOsc.stop();
      modulationOsc.disconnect();
      modulationOsc = null;
    }
    if (gainNode && audioCtx) {
      gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
      gainNode.gain.setValueAtTime(gainNode.gain.value, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
      setTimeout(() => {
        if (gainNode) {
          gainNode.disconnect();
          gainNode = null;
        }
      }, 400);
    }
  } catch (error) {
    console.error('Error stopping siren audio:', error);
  }
};

let toneCtx: AudioContext | null = null;

export const playTone = (freq: number, durationMs: number, type: OscillatorType = 'sine') => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!toneCtx) {
      toneCtx = new AudioContextClass();
    }
    if (toneCtx.state === 'suspended') {
      toneCtx.resume();
    }

    const osc = toneCtx.createOscillator();
    const gain = toneCtx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0.15, toneCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, toneCtx.currentTime + durationMs / 1000);

    osc.connect(gain);
    gain.connect(toneCtx.destination);

    osc.start(toneCtx.currentTime);
    osc.stop(toneCtx.currentTime + durationMs / 1000 + 0.1);
  } catch (e) {
    console.error('Audio error:', e);
  }
};
