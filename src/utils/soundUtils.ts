let audioContext: AudioContext | null = null;

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  if (!audioContext) {
    audioContext = new Context();
  }
  return audioContext;
};

export const primeCompletionSound = async () => {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === 'suspended') {
    await context.resume();
  }
  return context.state === 'running';
};

export const playCompletionSound = async () => {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === 'suspended') {
    await context.resume();
  }
  if (context.state !== 'running') return false;

  const now = context.currentTime;
  const notes = [
    { freq: 659.25, start: now, duration: 0.1 },
    { freq: 783.99, start: now + 0.12, duration: 0.14 },
  ];

  notes.forEach((note) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.freq, note.start);
    gain.gain.setValueAtTime(0.0001, note.start);
    gain.gain.exponentialRampToValueAtTime(0.05, note.start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, note.start + note.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(note.start);
    oscillator.stop(note.start + note.duration + 0.02);
  });

  return true;
};
