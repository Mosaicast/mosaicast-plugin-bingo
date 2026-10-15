// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useRef, useState } from 'react';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';

/** One place in a record's ranking, ready to draw. */
export interface RankRow {
  id: string;
  /** The number, formatted. */
  value: string;
  /** The player, by name — "You" for the viewer. */
  who?: string;
  /** The episode it happened on. */
  where?: string;
}

/** A record: its label and the ranking behind it, holder first. */
export interface RecordSpec {
  id: string;
  label: string;
  rows: RankRow[];
}

/**
 * The records, each showing its holder. "Ranking (n)" opens a dialog with everyone behind them, the way the
 * stats plugin's records do, so a record is never a lone number without anybody to measure it against.
 */
export function RecordsPanel({ i18n, records }: { i18n: PluginI18n; records: RecordSpec[] }) {
  const [open, setOpen] = useState<RecordSpec | null>(null);
  const shown = records.filter((r) => r.rows.length > 0);
  if (shown.length === 0) return null;
  return (
    <>
      <h3 className="bingo__chart-title">{i18n.t('history.records')}</h3>
      <div className="bingo__records">
        {shown.map((spec) => {
          const top = spec.rows[0];
          return (
            <div key={spec.id} className="bingo__record">
              <div className="bingo__tile-label">{spec.label}</div>
              <div className="bingo__record-value">
                {top.value}
                {top.who && <span className="bingo__record-who"> · {top.who}</span>}
              </div>
              {top.where && <div className="bingo__tile-sub">{top.where}</div>}
              {spec.rows.length > 1 && (
                <button type="button" className="bingo__more" aria-haspopup="dialog" onClick={() => setOpen(spec)}>
                  {i18n.t('records.ranking', { n: String(spec.rows.length) })}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <RankingDialog i18n={i18n} spec={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** A record's whole ranking in a modal dialog; Esc, the close button or a click outside closes it. */
function RankingDialog({ i18n, spec, onClose }: { i18n: PluginI18n; spec: RecordSpec | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (spec && !d.open) {
      // jsdom has no showModal; the attribute still makes the content visible there.
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!spec && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [spec]);
  const who = spec?.rows.some((r) => r.who);
  const where = spec?.rows.some((r) => r.where);
  return (
    <dialog
      ref={ref}
      className="bingo__dialog"
      aria-labelledby="bingo-ranking-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {spec && (
        <div className="bingo__dialog-body">
          <div className="bingo__dialog-head">
            <h3 id="bingo-ranking-title" className="bingo__chart-title">{spec.label}</h3>
            <button type="button" className="bingo__btn bingo__btn--quiet" onClick={onClose}
              aria-label={i18n.t('records.close')}>
              <Icon name="close" />
            </button>
          </div>
          <div className="bingo__table-wrap">
            <table className="bingo__table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {who && <th scope="col" className="bingo__table-text">{i18n.t('records.who')}</th>}
                  {where && <th scope="col" className="bingo__table-text">{i18n.t('history.episode')}</th>}
                  <th scope="col">{i18n.t('records.value')}</th>
                </tr>
              </thead>
              <tbody>
                {spec.rows.map((r, i) => (
                  <tr key={r.id} className={i === 0 ? 'bingo__table-first' : undefined}>
                    <td>{i + 1}</td>
                    {who && <th scope="row">{r.who}</th>}
                    {where && <td className="bingo__table-text">{r.where}</td>}
                    <td>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </dialog>
  );
}
