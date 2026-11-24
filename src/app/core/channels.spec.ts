import { canToggleChannel, channelOn, setChannel, toggleChannel } from './channels';

const set = (fg: boolean, bg: boolean, ch: boolean) => ({ fg, bg, ch });

describe('channels', () => {
  it('toggles freely while another channel stays on', () => {
    expect(toggleChannel(set(true, true, false), 'fg')).toEqual(set(false, true, false));
    expect(toggleChannel(set(true, false, false), 'ch')).toEqual(set(true, false, true));
  });

  it('never turns the last channel off', () => {
    const only = set(false, true, false);
    expect(canToggleChannel(only, 'bg')).toBe(false);
    expect(toggleChannel(only, 'bg')).toBe(only);
    expect(setChannel(only, 'bg', false)).toBe(only);
  });

  it('treats locked channels as on and unchangeable', () => {
    const rules = { locked: { ch: true } };
    expect(channelOn(set(false, false, false), 'ch', rules)).toBe(true);
    expect(toggleChannel(set(true, false, false), 'fg', rules)).toEqual(set(false, false, false)); // ch still in effect
    expect(canToggleChannel(set(true, false, false), 'ch', rules)).toBe(false);
  });

  it('ignores unavailable channels when counting what is on', () => {
    const rules = { unavailable: { bg: true } };
    expect(channelOn(set(true, true, false), 'bg', rules)).toBe(false);
    expect(canToggleChannel(set(true, true, false), 'fg', rules)).toBe(false); // bg doesn't count
    expect(canToggleChannel(set(true, true, false), 'bg', rules)).toBe(false);
  });
});
