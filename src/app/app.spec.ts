import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(() => {
    // jsdom has no canvas implementation; a no-op 2D context is enough for a shell test.
    const ctx = new Proxy({ measureText: () => ({ width: 8 }) }, {
      get: (t, p) => (p in t ? t[p as keyof typeof t] : () => undefined),
      set: () => true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  });

  it('renders the editor shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-toolbar')).toBeTruthy();
    expect(el.querySelector('app-canvas-view canvas')).toBeTruthy();
    expect(el.querySelector('app-status-bar')?.textContent).toContain('80 × 40');
  });
});
