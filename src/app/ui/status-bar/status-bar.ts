import { Component, computed, inject } from '@angular/core';
import { WEIGHT_NAMES } from '../../core/fonts/fonts';
import { EditorStore } from '../../state/editor.store';

@Component({
  selector: 'app-status-bar',
  template: `
    <span>{{ store.doc().width }} × {{ store.doc().height }}</span>
    <span>{{ store.font().name }} {{ weightName() }}</span>
    <span>{{ store.zoom() * 100 }}%</span>
    @if (store.rect(); as r) {
      <span>{{ r.width }} × {{ r.height }} selected</span>
    } @else if (store.selectionSize(); as n) {
      <span>{{ n }} selected</span>
    }
    <span class="pos">
      @if (store.hoverCell(); as c) {
        {{ c.x }}, {{ c.y }}
      }
    </span>
  `,
  styles: `
    :host {
      display: flex;
      gap: 20px;
      padding: 4px 12px;
      font-size: 0.8rem;
      background: var(--panel-bg);
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .pos {
      margin-left: auto;
    }
  `,
})
export class StatusBar {
  protected readonly store = inject(EditorStore);
  protected readonly weightName = computed(() => WEIGHT_NAMES[this.store.fontWeight()] ?? this.store.fontWeight());
}
