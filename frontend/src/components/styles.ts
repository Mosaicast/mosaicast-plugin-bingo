// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * Every colour is a host theme token (`--mc-*`), never a literal: the shell owns light and dark and the
 * accent seed, and a plugin that hardcodes a colour looks broken the moment an operator changes either.
 * `--mc-accent` is for fills only; text, focus rings and the borders that carry a state (a hit, a pressed
 * tick, the selected tab) use `--mc-accent-text`, the same colour clamped to WCAG AA (platformApi 0.16.0).
 * The seed is not contrast-checked, and a pale one measured 1.12:1 as text.
 *
 * The host keeps `style-src 'unsafe-inline'` precisely because a runtime-constructed shadow root cannot
 * carry a nonce, so an inline `<style>` is the supported way to do this.
 *
 * A tile renders in regions whose width it does not control — a feed card, an episode body, a sidebar —
 * so the grid is sized in container-query terms and everything wide scrolls inside its own box rather
 * than pushing the page sideways.
 */
import { ICON_CSS } from '../icons';

// NOTE: no backticks anywhere below — this whole block is one template literal, and a stray backtick
// ends it mid-rule. `npm run typecheck` is what catches that.
export const BINGO_CSS =
  ICON_CSS +
  `
  :host { display: block; container-type: inline-size; }

  .bingo { color: var(--mc-text); font: inherit; line-height: 1.5; }

  /* The main tile stands as its own card, the way the shell's own panels do. The feed badge and the
     sidebar board are already inside host chrome, so only this one draws a container. */
  .bingo--tile {
    background: var(--mc-surface); border: 1px solid var(--mc-border);
    border-radius: .75rem; padding: 1rem;
  }
  .bingo *, .bingo *::before, .bingo *::after { box-sizing: border-box; }

  .bingo__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; margin-bottom: .75rem; }
  .bingo__title { font-weight: 600; margin: 0; }
  .bingo__phase {
    display: inline-flex; align-items: center; gap: .35rem;
    font-size: .8125rem; padding: .1rem .5rem; border-radius: 999px;
    border: 1px solid var(--mc-border); color: var(--mc-text-muted);
  }
  .bingo__hint { color: var(--mc-text-muted); font-size: .875rem; margin: 0 0 .75rem; }

  .bingo__tabs {
    display: flex; gap: .25rem; overflow-x: auto; margin-bottom: .75rem;
    border-bottom: 1px solid var(--mc-border); scrollbar-width: thin;
  }
  .bingo__tab {
    flex: 0 0 auto; appearance: none; background: none; border: 0; cursor: pointer;
    font: inherit; color: var(--mc-text-muted); padding: .4rem .7rem;
    border-bottom: 2px solid transparent; white-space: nowrap;
  }
  .bingo__tab:hover { color: var(--mc-text); }
  .bingo__tab[aria-selected="true"] { color: var(--mc-text); border-bottom-color: var(--mc-accent-text); }
  .bingo__tab:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }
  .bingo__tab-score { color: var(--mc-text-muted); font-variant-numeric: tabular-nums; }

  .bingo__grid { display: grid; gap: .375rem; }
  .bingo__cell {
    display: flex; align-items: center; justify-content: center; text-align: center;
    min-height: 4.25rem; padding: .4rem; border-radius: .5rem; overflow-wrap: anywhere;
    border: 1px solid var(--mc-border); background: var(--mc-bg);
    font-size: .8125rem; line-height: 1.25;
  }
  .bingo__cell--hit { border-color: var(--mc-accent-text); color: var(--mc-accent-text); font-weight: 600; }
  .bingo__cell--free { color: var(--mc-text-muted); font-style: italic; }
  .bingo__cell--empty { color: var(--mc-text-muted); border-style: dashed; }
  .bingo__cell--duplicate { border-color: var(--mc-accent-text); border-width: 2px; border-style: dashed; }
  .bingo__cell--similar { border-style: dashed; }
  .bingo__checks { list-style: none; margin: .5rem 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
  .bingo__checks .bingo__warn { margin: 0; }
  .bingo__cell-input {
    width: 100%; height: 100%; min-height: 3.4rem; resize: none; font: inherit; font-size: .8125rem;
    text-align: center; color: var(--mc-text); background: none; border: 0; padding: 0;
    /* A textarea starts its text at the top, so an editable square read as top-aligned while the same
       square read-only was centred. align-content centres the lines inside the box, which keeps one
       line in the middle of the square and still lets a long entry fill it from the top. */
    align-content: center;
  }
  .bingo__cell-input:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 2px; }

  .bingo__actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .75rem; }
  .bingo__btn {
    appearance: none; font: inherit; cursor: pointer; border-radius: .4rem;
    padding: .4rem .8rem; min-height: 2.25rem;
    background: var(--mc-accent); color: var(--mc-accent-contrast); border: 1px solid transparent;
  }
  .bingo__btn--quiet { background: none; color: var(--mc-text); border-color: var(--mc-border); }
  .bingo__btn:disabled { opacity: .55; cursor: default; }
  .bingo__btn:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }

  .bingo__note { color: var(--mc-text-muted); font-size: .8125rem; margin: 0; }
  .bingo__warn {
    border-left: 3px solid var(--mc-accent-2, var(--mc-accent));
    padding: .5rem .75rem; margin: 0 0 .75rem; background: var(--mc-bg);
    font-size: .875rem;
  }

  .bingo__suggestions { display: flex; flex-direction: column; gap: .4rem; margin-bottom: .6rem; }
  .bingo__suggestions .bingo__suggest { margin-bottom: 0; }
  .bingo__suggest { display: flex; flex-wrap: wrap; gap: .35rem; align-items: center; margin-bottom: .6rem; }
  .bingo__chip {
    appearance: none; font: inherit; font-size: .8125rem; cursor: pointer;
    padding: .2rem .55rem; border-radius: 999px; min-height: 1.9rem;
    border: 1px solid var(--mc-border); background: var(--mc-bg); color: var(--mc-text);
  }
  .bingo__chip:hover { border-color: var(--mc-accent-text); color: var(--mc-accent-text); }
  .bingo__chip:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }

  .bingo__prefs { display: flex; flex-direction: column; gap: .3rem; margin-top: .75rem; }
  .bingo__check { display: flex; align-items: center; gap: .45rem; font-size: .875rem; cursor: pointer; }
  .bingo__check input { accent-color: var(--mc-accent); width: 1rem; height: 1rem; }

  .bingo__create { margin-top: .75rem; }
  .bingo__field { display: flex; flex-direction: column; gap: .2rem; font-size: .8125rem; color: var(--mc-text-muted); }
  .bingo__input, .bingo__select {
    font: inherit; font-size: .875rem; color: var(--mc-text); background: var(--mc-bg);
    border: 1px solid var(--mc-border); border-radius: .4rem; padding: .35rem .5rem; min-height: 2.25rem;
  }
  .bingo__input:focus-visible, .bingo__select:focus-visible {
    outline: 2px solid var(--mc-accent-text); outline-offset: 1px;
  }

  .bingo__board { display: flex; flex-direction: column; gap: .35rem; }
  .bingo__tick {
    display: flex; align-items: center; gap: .5rem; width: 100%;
    appearance: none; font: inherit; text-align: left; cursor: pointer;
    padding: .45rem .6rem; border-radius: .4rem; min-height: 2.25rem;
    border: 1px solid var(--mc-border); background: var(--mc-surface); color: var(--mc-text);
  }
  .bingo__tick[aria-pressed="true"] { border-color: var(--mc-accent-text); color: var(--mc-accent-text); }
  .bingo__tick:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }
  .bingo__tick-count { margin-left: auto; color: var(--mc-text-muted); font-size: .8125rem; }
  .bingo__cand { display: flex; flex-direction: column; gap: .25rem; }
  .bingo__more {
    align-self: flex-start; font: inherit; font-size: .8125rem; color: var(--mc-text-muted);
    background: none; border: 0; padding: .1rem .25rem; cursor: pointer; text-decoration: underline;
  }
  .bingo__more:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }
  .bingo__variants {
    border-left: 2px solid var(--mc-border); padding: .25rem 0 .5rem .75rem; margin-left: .5rem;
    display: flex; flex-direction: column; gap: .5rem;
  }
  .bingo__variant-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
  .bingo__variant { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; overflow-wrap: anywhere; }
  .bingo__btn--small { padding: .15rem .55rem; font-size: .8125rem; min-height: 0; }

  .bingo__modal {
    border: 1px solid var(--mc-border); border-radius: .75rem; padding: 1rem;
    background: var(--mc-surface); color: var(--mc-text);
    width: min(32rem, calc(100vw - 2rem)); max-height: 80vh; overflow: auto;
  }
  .bingo__modal::backdrop { background: rgb(0 0 0 / .45); }

  .bingo__place {
    min-width: 1.25rem; text-align: right; font-variant-numeric: tabular-nums;
    color: var(--mc-text-muted); font-size: .8125rem;
  }

  .bingo__rows { list-style: none; margin: 0; padding: 0; }
  .bingo__row {
    display: flex; align-items: baseline; gap: .5rem;
    padding: .3rem 0; border-bottom: 1px solid var(--mc-border);
  }
  .bingo__row:last-child { border-bottom: 0; }
  .bingo__avatar {
    width: 1.5rem; height: 1.5rem; border-radius: 50%; flex: 0 0 auto;
    object-fit: cover; background: var(--mc-bg); border: 1px solid var(--mc-border);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: .75rem; color: var(--mc-text-muted);
  }
  .bingo__role {
    font-size: .6875rem; text-transform: uppercase; letter-spacing: .04em;
    padding: .05rem .35rem; border-radius: .25rem;
    border: 1px solid var(--mc-border); color: var(--mc-text-muted);
  }
  .bingo__row-score { margin-left: auto; font-variant-numeric: tabular-nums; }
  .bingo__recap-list { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: .2rem; font-size: .875rem; }
  .bingo__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
  .bingo__list li { overflow-wrap: anywhere; }
  .bingo__link { color: var(--mc-accent-text); text-decoration: underline; }
  .bingo__link:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }
  a.bingo__btn { display: inline-flex; align-items: center; text-decoration: none; }
  .bingo__share { display: inline-flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .bingo__section-title { font-size: .8125rem; color: var(--mc-text-muted); margin: .75rem 0 .25rem; }

  .bingo__spoiler { border: 1px dashed var(--mc-border); border-radius: .5rem; padding: 1rem; text-align: center; }

  .bingo__badge { display: inline-flex; align-items: center; gap: .35rem; font-size: .8125rem; color: var(--mc-text-muted); }

  .bingo-icon { width: 1em; height: 1em; flex: 0 0 auto; }

  /* The narrowest column this tile ever gets is a phone-width feed card. */
  /* history: the site page's stats and charts, in the visual language of mosaicast-plugin-stats */
  .bingo__history { display: flex; flex-direction: column; gap: .5rem; margin-top: .5rem; }
  .bingo__pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .bingo__pill {
    font: inherit; font-size: .875rem; color: var(--mc-text); background: none; cursor: pointer;
    border: 1px solid var(--mc-border); border-radius: 999px; padding: 3px 12px; min-height: 32px;
  }
  .bingo__pill--small { font-size: .8125rem; min-height: 28px; padding: 2px 10px; }
  .bingo__pill[aria-pressed="true"] { background: var(--mc-accent); color: var(--mc-accent-contrast); border-color: var(--mc-accent); }
  .bingo__pill:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }
  .bingo__tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
  .bingo__tile, .bingo__record { border: 1px solid var(--mc-border); border-radius: 10px; padding: 10px 12px; min-width: 0; }
  .bingo__record { border-width: 0 0 0 3px; border-radius: 0; padding: 2px 0 2px 10px; }
  .bingo__tile-label { font-size: .8rem; color: var(--mc-text-muted); }
  .bingo__tile-value { font-size: 1.3rem; font-weight: 600; margin-top: 2px; overflow-wrap: anywhere; }
  .bingo__tile-sub { font-size: .78rem; color: var(--mc-text-muted); margin-top: 2px; overflow-wrap: anywhere; }
  .bingo__records { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .bingo__record-value { font-weight: 600; overflow-wrap: anywhere; }
  .bingo__record-who { font-weight: 400; color: var(--mc-text-muted); }
  .bingo__chart-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: .75rem; }
  .bingo__chart-title { font-size: 1rem; margin: .75rem 0 .25rem; }
  .bingo__chart-head .bingo__chart-title { margin: 0; }
  .bingo__chart { position: relative; }
  .bingo__chart svg { display: block; width: 100%; height: auto; overflow: visible; }
  .bingo__grid-line { stroke: var(--mc-border); stroke-width: 1; }
  .bingo__axis { fill: var(--mc-text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .bingo__end-label { fill: var(--mc-text); font-size: 12px; }
  .bingo__crosshair { stroke: var(--mc-text-muted); stroke-width: 1; }
  .bingo__reference { stroke: var(--mc-text-muted); stroke-width: 1; stroke-dasharray: 3 3; }
  .bingo__hit { fill: transparent; cursor: pointer; }
  .bingo__hit:hover, .bingo__hit:focus { fill: color-mix(in srgb, var(--mc-text) 6%, transparent); outline: none; }
  .bingo__tip {
    position: absolute; pointer-events: none; z-index: 2; background: var(--mc-surface); color: var(--mc-text);
    border: 1px solid var(--mc-border); border-radius: 8px; padding: 8px 10px; font-size: .82rem; line-height: 1.4;
    box-shadow: 0 4px 16px rgb(0 0 0 / .12); min-width: 150px; max-width: 260px;
  }
  .bingo__tip-title { font-weight: 600; margin-bottom: 4px; }
  .bingo__tip-row { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
  .bingo__tip-row span:first-child { display: inline-flex; align-items: center; gap: 6px; }
  .bingo__legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 6px; font-size: .875rem; }
  .bingo__legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .bingo__swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; display: inline-block; }
  .bingo__swatch--line { width: 14px; height: 3px; border-radius: 2px; }
  .bingo__players { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .bingo__chip--player { display: inline-flex; align-items: center; gap: 6px; }
  .bingo__chip--player[aria-pressed="true"] { border-color: var(--mc-accent-text); }
  .bingo__chip--player:disabled { opacity: .5; cursor: default; }
  .bingo__table-wrap { overflow-x: auto; }
  .bingo__table { border-collapse: collapse; font-size: .85rem; width: 100%; }
  .bingo__table th, .bingo__table td { padding: 4px 8px; border-bottom: 1px solid var(--mc-border); text-align: right; white-space: nowrap; }
  .bingo__table th[scope="row"], .bingo__table thead th:first-child { text-align: left; font-weight: 400; }
  .bingo__table td { font-variant-numeric: tabular-nums; }

  @container (max-width: 22rem) {
    .bingo__cell { min-height: 3.25rem; font-size: .75rem; }
    .bingo__grid { gap: .25rem; }
  }
`;
