/** On/off state of a cell's three channels: foreground color, background color, text. */
export interface ChannelSet {
  fg: boolean;
  bg: boolean;
  ch: boolean;
}
export type Channel = keyof ChannelSet;
export const CHANNELS: readonly Channel[] = ['fg', 'bg', 'ch'];

/**
 * Extra rules for a channel set: `locked` channels are always on (e.g. the
 * text tool always writes characters); `unavailable` ones are always off
 * (e.g. pasting a multi-channel clip into a channel it doesn't have).
 */
export interface ChannelRules {
  locked?: Partial<ChannelSet>;
  unavailable?: Partial<ChannelSet>;
}

/** Whether a channel is in effect, after the rules. */
export function channelOn(set: ChannelSet, k: Channel, rules: ChannelRules = {}): boolean {
  return !rules.unavailable?.[k] && (set[k] || !!rules.locked?.[k]);
}

/** Whether a channel can be switched: not locked or unavailable, and never the last one on. */
export function canToggleChannel(set: ChannelSet, k: Channel, rules: ChannelRules = {}): boolean {
  if (rules.locked?.[k] || rules.unavailable?.[k]) return false;
  if (!channelOn(set, k, rules)) return true;
  return CHANNELS.some((o) => o !== k && channelOn(set, o, rules));
}

/** Sets a channel, unless that would break the rules (then the set is returned unchanged). */
export function setChannel(set: ChannelSet, k: Channel, on: boolean, rules: ChannelRules = {}): ChannelSet {
  if (channelOn(set, k, rules) === on || !canToggleChannel(set, k, rules)) return set;
  return { ...set, [k]: on };
}

export function toggleChannel(set: ChannelSet, k: Channel, rules: ChannelRules = {}): ChannelSet {
  return setChannel(set, k, !channelOn(set, k, rules), rules);
}
