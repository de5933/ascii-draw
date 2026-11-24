import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChannelRules, ChannelSet } from '../../core/channels';
import { ChannelToggle } from './channel-toggle';

@Component({
  imports: [ChannelToggle],
  template: `<app-channel-toggle [(value)]="value" [rules]="rules()" />`,
})
class Host {
  readonly value = signal<ChannelSet>({ fg: true, bg: false, ch: true });
  readonly rules = signal<ChannelRules>({});
}

describe('ChannelToggle', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const buttons = () => [...el.querySelectorAll('button')] as HTMLButtonElement[];
    const click = async (i: number) => {
      buttons()[i].click();
      await fixture.whenStable();
    };
    return { fixture, el, buttons, click };
  }

  it('shows Channels with Fg / Bg / Txt and their states', async () => {
    const { el, buttons } = await setup();
    expect(el.querySelector('.label')?.textContent?.trim()).toBe('Channels');
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Fg', 'Bg', 'Txt']);
    expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'true']);
  });

  it('toggles, but keeps at least one channel on', async () => {
    const { fixture, click } = await setup();
    await click(0); // fg off
    expect(fixture.componentInstance.value()).toEqual({ fg: false, bg: false, ch: true });
    await click(2); // last one: stays on
    expect(fixture.componentInstance.value()).toEqual({ fg: false, bg: false, ch: true });
    await click(1);
    expect(fixture.componentInstance.value()).toEqual({ fg: false, bg: true, ch: true });
  });

  it('disables unavailable channels', async () => {
    const { fixture, buttons } = await setup();
    fixture.componentInstance.rules.set({ unavailable: { bg: true } });
    await fixture.whenStable();
    expect(buttons()[1].disabled).toBe(true);
  });
});
