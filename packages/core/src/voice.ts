/**
 * The voice grammar. Vosk runs with a fixed grammar of these nine words plus
 * "[unk]" so anything else is rejected instead of guessed. Voice is optional:
 * every command has a hand, gaze and switch equivalent.
 */
export const VOICE_COMMANDS = [
  'catch',
  'next',
  'back',
  'hint',
  'repeat',
  'pause',
  'resume',
  'menu',
  'louder',
] as const;

export type VoiceCommand = (typeof VOICE_COMMANDS)[number];

/** JSON grammar string passed to the Vosk KaldiRecognizer. */
export const VOSK_GRAMMAR = JSON.stringify([...VOICE_COMMANDS, '[unk]']);

const SET = new Set<string>(VOICE_COMMANDS);

/** Map a final recognizer transcript to commands, in spoken order. */
export function parseVoice(text: string): VoiceCommand[] {
  return text
    .toLowerCase()
    .split(/[^a-z[\]]+/)
    .filter((w) => SET.has(w)) as VoiceCommand[];
}

/** What each command does, for the on-screen command list and captions. */
export const VOICE_HELP: Record<VoiceCommand, string> = {
  catch: 'catch the outlined light',
  next: 'outline the next light',
  back: 'outline the previous light',
  hint: 'pulse the nearest hum, show an arrow',
  repeat: 'play the nearest hum again',
  pause: 'pause the round',
  resume: 'resume the round',
  menu: 'open settings',
  louder: 'raise the hum volume',
};
