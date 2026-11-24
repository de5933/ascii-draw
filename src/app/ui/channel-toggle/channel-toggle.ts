import { Component, input, model } from '@angular/core';
import { CHANNELS, Channel, ChannelRules, ChannelSet, canToggleChannel, channelOn, toggleChannel } from '../../core/channels';

const NAMES: Record<Channel, { short: string; long: string }> = {
  fg: { short: 'Fg', long: 'Foreground color' },
  bg: { short: 'Bg', long: 'Background color' },
  ch: { short: 'Txt', long: 'Text' },
};

/**
 * "Channels": a compound button toggling foreground, background and text.
 * At least one channel always stays on. Bind with [(value)].
 */
@Component({
  selector: 'app-channel-toggle',
  template: `
    @if (label()) {
      <span class="label" [id]="labelId">{{ label() }}</span>
    }
    <div class="group" role="group" [attr.aria-labelledby]="label() ? labelId : null" [attr.aria-label]="label() ? null : 'Channels'">
      @for (k of channels; track k) {
        <button
          type="button"
          [class.on]="isOn(k)"
          [attr.aria-pressed]="isOn(k)"
          [disabled]="!!rules().unavailable?.[k]"
          [class.fixed]="isOn(k) && !canToggle(k)"
          [title]="title(k)"
          (click)="toggle(k)"
        >
          {{ names[k].short }}
        </button>
      }
    </div>
  `,
  styleUrl: './channel-toggle.css',
})
export class ChannelToggle {
  private static nextId = 0;

  readonly value = model.required<ChannelSet>();
  readonly rules = input<ChannelRules>({});
  /** Shown before the buttons; empty for none (e.g. under a section heading). */
  readonly label = input('Channels');
  /** Optional per-channel tooltip text, appended to the channel name. */
  readonly hints = input<Partial<Record<Channel, string>>>({});

  protected readonly channels = CHANNELS;
  protected readonly names = NAMES;
  protected readonly labelId = `channels-label-${ChannelToggle.nextId++}`;

  protected isOn(k: Channel): boolean {
    return channelOn(this.value(), k, this.rules());
  }

  protected canToggle(k: Channel): boolean {
    return canToggleChannel(this.value(), k, this.rules());
  }

  protected toggle(k: Channel): void {
    const next = toggleChannel(this.value(), k, this.rules());
    if (next !== this.value()) this.value.set(next);
  }

  protected title(k: Channel): string {
    const r = this.rules();
    const extra = this.hints()[k];
    let state: string;
    if (r.locked?.[k]) state = 'always on here';
    else if (r.unavailable?.[k]) state = 'not available';
    else if (this.isOn(k) && !this.canToggle(k)) state = 'on (at least one channel must stay on)';
    else state = this.isOn(k) ? 'on' : 'off';
    return `${NAMES[k].long}: ${state}${extra ? ` — ${extra}` : ''}`;
  }
}
