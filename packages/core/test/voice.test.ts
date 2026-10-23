import { describe, expect, it } from 'vitest';
import { parseVoice, VOSK_GRAMMAR, VOICE_COMMANDS } from '../src/voice.js';

describe('voice grammar', () => {
  it('has exactly the nine commands plus [unk]', () => {
    expect(VOICE_COMMANDS).toEqual(['catch', 'next', 'back', 'hint', 'repeat', 'pause', 'resume', 'menu', 'louder']);
    expect(JSON.parse(VOSK_GRAMMAR)).toEqual([...VOICE_COMMANDS, '[unk]']);
  });

  it('maps recognizer output to commands in order', () => {
    expect(parseVoice('catch')).toEqual(['catch']);
    expect(parseVoice('next next catch')).toEqual(['next', 'next', 'catch']);
    expect(parseVoice('Pause')).toEqual(['pause']);
  });

  it('drops [unk] and anything outside the grammar', () => {
    expect(parseVoice('[unk]')).toEqual([]);
    expect(parseVoice('[unk] hint [unk]')).toEqual(['hint']);
    expect(parseVoice('')).toEqual([]);
    expect(parseVoice('cats')).toEqual([]);
  });
});
