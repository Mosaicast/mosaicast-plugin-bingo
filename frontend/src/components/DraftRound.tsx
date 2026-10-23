// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DisplaySnapshot, PluginContext, UserRef } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';
import { draftErrorKey, inviteLink } from '../draft';
import type { DraftSettings, DraftView } from '../types';
import { nameOf } from './common';
import { DraftGame } from './DraftGame';
import { DraftOrder } from './DraftOrder';
import { SITE, useDraftRound, useTicker } from './useDraftRound';
import { resolvePeople } from './useBingo';

/**
 * One draft round, `/p/bingo/draft/<id>`: the lobby, the game, the result.
 *
 * Members only. Somebody holding the invite link's code sees a short preview and can join; anybody else is
 * told the round isn't theirs, which is all the backend tells them too.
 */
export function DraftRound({ ctx, i18n, id }: { ctx: PluginContext; i18n: PluginI18n; id: string }) {
  const code = ctx.route.query.get('code');
  const round = useDraftRound(ctx, id, code);
  const { view, preview } = round;
  const [notice, setNotice] = useState<string | null>(null);
  const [people, setPeople] = useState<Record<string, UserRef>>({});
  const [episode, setEpisode] = useState<DisplaySnapshot | null>(null);
  const ticking = Boolean(view && view.status === 'RUNNING');
  const now = useTicker(ticking);
  const serverNow = now + round.offset;

  const everyone = useMemo(() => {
    if (view) return [view.host, ...view.order, ...view.invited, ...(view.game?.seats ?? []).map((s) => s.userId)];
    return preview ? [preview.host] : [];
  }, [view, preview]);
  const peopleKey = [...new Set(everyone)].sort().join(',');
  useEffect(() => {
    let live = true;
    void resolvePeople(ctx, peopleKey ? peopleKey.split(',') : []).then((p) => {
      if (live) setPeople(p);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on who is in the round
  }, [peopleKey]);

  const slug = view?.episode ?? preview?.episode;
  useEffect(() => {
    if (!slug) return;
    let live = true;
    ctx.feeds
      .display(slug)
      .then((s) => live && setEpisode(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read per episode
  }, [slug]);

  const showError = (failure: string) => setNotice(i18n.t(draftErrorKey(failure)));

  const head = (
    <header className="bingo__page-head">
      <h1 className="bingo__page-title">
        <Icon name="dice" /> {i18n.t('draft.title')}
      </h1>
      {episode && slug ? (
        <p className="bingo__hint">
          <a className="bingo__link" href={ctx.links.episode(slug)}>
            {i18n.t('draft.episode', { title: episode.title })}
          </a>
        </p>
      ) : (view?.quiet || preview?.quiet) ? (
        <p className="bingo__hint">{i18n.t('draft.quietEpisode')}</p>
      ) : null}
    </header>
  );

  if (!ctx.user) {
    return (
      <>
        {head}
        <p className="bingo__panel bingo__note">{i18n.t('draft.signIn')}</p>
      </>
    );
  }
  if (!ctx.actions || !ctx.channels) {
    return (
      <>
        {head}
        <p className="bingo__panel bingo__note">{i18n.t('draft.unavailable')}</p>
      </>
    );
  }
  if (round.loading) {
    return (
      <>
        {head}
        <p className="bingo__note">{i18n.t('common.loading')}</p>
      </>
    );
  }
  if (!view && !preview) {
    const missing = round.failure === 'not-found';
    return (
      <>
        {head}
        <p className="bingo__panel bingo__note">{missing ? i18n.t('draft.notFound') : i18n.t('draft.notYours')}</p>
      </>
    );
  }

  const me = ctx.user.id;
  return (
    <>
      {head}
      <div className="bingo__panel bingo__draft">
        {round.connection === 'connecting' && view && <p className="bingo__note">{i18n.t('draft.reconnecting')}</p>}
        {notice && (
          <p className="bingo__warn" role="alert">
            {notice}{' '}
            <button type="button" className="bingo__btn bingo__btn--quiet bingo__btn--small" onClick={() => setNotice(null)}>
              {i18n.t('draft.lobby.close')}
            </button>
          </p>
        )}
        {preview && !view && (
          <Preview i18n={i18n} people={people} preview={preview} onJoin={async () => {
            const failure = await round.act('draft-join', { code });
            if (failure) showError(failure);
          }} />
        )}
        {view?.status === 'LOBBY' && (
          <Lobby ctx={ctx} i18n={i18n} view={view} me={me} people={people} act={round.act} onError={showError} />
        )}
        {view && (view.status === 'RUNNING' || view.status === 'FINISHED') && (
          <>
            {view.status === 'FINISHED' && (
              <p className="bingo__warn">
                {i18n.t('draft.finished')}{' '}
                {slug && <a className="bingo__link" href={ctx.links.episode(slug)}>{i18n.t('draft.openEpisode')}</a>}
              </p>
            )}
            <DraftGame i18n={i18n} view={view} me={me} people={people} serverNow={serverNow} act={round.act}
              onError={showError} />
          </>
        )}
        {view?.status === 'CANCELLED' && <p className="bingo__note">{i18n.t('draft.cancelled')}</p>}
      </div>
    </>
  );
}

function Preview({
  i18n,
  people,
  preview,
  onJoin,
}: {
  i18n: PluginI18n;
  people: Record<string, UserRef>;
  preview: NonNullable<ReturnType<typeof useDraftRound>['preview']>;
  onJoin: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p>{i18n.t('draft.preview.joined', { name: nameOf(people[preview.host], i18n), count: String(preview.players) })}</p>
      <p className="bingo__note">{i18n.t('draft.hint')}</p>
      {preview.quiet && <p className="bingo__warn">{i18n.t('draft.error.quiet')}</p>}
      {preview.status !== 'LOBBY' && <p className="bingo__note">{i18n.t('draft.preview.started')}</p>}
      {preview.status === 'LOBBY' && !preview.quiet && (
        <div className="bingo__actions">
          <button type="button" className="bingo__btn" disabled={busy} onClick={async () => {
            setBusy(true);
            await onJoin();
            setBusy(false);
          }}>
            {i18n.t('draft.lobby.join')}
          </button>
        </div>
      )}
    </>
  );
}

/** The lobby: who's in, in what order, on which clock; the host sets it up and starts. */
function Lobby({
  ctx,
  i18n,
  view,
  me,
  people,
  act,
  onError,
}: {
  ctx: PluginContext;
  i18n: PluginI18n;
  view: DraftView;
  me: string;
  people: Record<string, UserRef>;
  act: (name: string, payload: Record<string, unknown>) => Promise<string | null>;
  onError: (code: string) => void;
}) {
  const host = view.host === me;
  const joined = view.order.includes(me);
  const run = async (name: string, payload: Record<string, unknown> = {}) => {
    const failure = await act(name, payload);
    if (failure) onError(failure);
    return failure;
  };

  return (
    <div className="bingo__lobby">
      <p className="bingo__note">{i18n.t('draft.hint')}</p>

      <p className="bingo__section-title">{i18n.t('draft.lobby.order')}</p>
      {host && view.order.length > 1 && <p className="bingo__note">{i18n.t('draft.lobby.orderHint')}</p>}
      <DraftOrder i18n={i18n} ids={view.order} people={people} online={view.online ?? []} host={view.host}
        onChange={host ? (order) => void run('draft-setup', { order }) : undefined} />

      {view.invited.length > 0 && (
        <>
          <p className="bingo__section-title">{i18n.t('draft.lobby.invited')}</p>
          <p className="bingo__note">{view.invited.map((u) => nameOf(people[u], i18n)).join(', ')}</p>
        </>
      )}

      {host ? (
        <>
          <Rules i18n={i18n} view={view} me={me} onSave={(settings, hostPlays) =>
            void run('draft-setup', { settings, hostPlays })} />
          <Invite ctx={ctx} i18n={i18n} view={view} onInvite={(userIds) => run('draft-invite', { userIds })} />
          <div className="bingo__actions">
            <button type="button" className="bingo__btn" disabled={view.order.length < 2}
              onClick={() => void run('draft-start')}>
              {i18n.t('draft.lobby.start')}
            </button>
            <button type="button" className="bingo__btn bingo__btn--quiet" onClick={() => {
              if (window.confirm(i18n.t('draft.lobby.cancelConfirm'))) void run('draft-cancel');
            }}>
              {i18n.t('draft.lobby.cancel')}
            </button>
          </div>
          {view.order.length < 2 && <p className="bingo__note">{i18n.t('draft.lobby.needsTwo')}</p>}
        </>
      ) : joined ? (
        <>
          <RulesSummary i18n={i18n} settings={view.settings} />
          <p>{i18n.t('draft.lobby.waiting', { name: nameOf(people[view.host], i18n) })}</p>
          <div className="bingo__actions">
            <button type="button" className="bingo__btn bingo__btn--quiet" onClick={() => void run('draft-decline')}>
              {i18n.t('draft.lobby.leave')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{i18n.t('draft.lobby.invitedYou', { name: nameOf(people[view.host], i18n) })}</p>
          <RulesSummary i18n={i18n} settings={view.settings} />
          <div className="bingo__actions">
            <button type="button" className="bingo__btn" onClick={() => void run('draft-join')}>
              {i18n.t('draft.lobby.join')}
            </button>
            <button type="button" className="bingo__btn bingo__btn--quiet" onClick={() => void run('draft-decline')}>
              {i18n.t('draft.lobby.decline')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Seconds as the form shows them: blank for no limit. */
function field(value: number | null, per = 1): string {
  return value === null || value === undefined ? '' : String(Math.round(value / per));
}

function parse(raw: string, per = 1): number | null {
  const n = Number(raw.trim());
  return raw.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * per);
}

/** The host's rules. Each change is saved as it's made; the round shows what the backend accepted. */
function Rules({
  i18n,
  view,
  me,
  onSave,
}: {
  i18n: PluginI18n;
  view: DraftView;
  me: string;
  onSave: (settings: DraftSettings, hostPlays: boolean) => void;
}) {
  const s = view.settings;
  const hostPlays = view.order.includes(me);
  const [turn, setTurn] = useState(field(s.turnSeconds));
  const [bank, setBank] = useState(field(s.bankSeconds, 60));
  const [increment, setIncrement] = useState(field(s.incrementSeconds));
  // Follows what the backend accepted, so a refused number goes back to the one in force.
  useEffect(() => {
    setTurn(field(s.turnSeconds));
    setBank(field(s.bankSeconds, 60));
    setIncrement(field(s.incrementSeconds));
  }, [s.turnSeconds, s.bankSeconds, s.incrementSeconds]);

  const save = (next: Partial<DraftSettings>, plays = hostPlays) =>
    onSave(
      {
        ...s,
        turnSeconds: parse(turn),
        bankSeconds: parse(bank, 60),
        incrementSeconds: parse(increment) ?? 0,
        ...next,
      },
      plays,
    );

  return (
    <fieldset className="bingo__rules">
      <legend className="bingo__section-title">{i18n.t('draft.lobby.settings')}</legend>
      <label className="bingo__check">
        <input type="checkbox" checked={hostPlays} onChange={(e) => save({}, e.target.checked)} />
        {i18n.t('draft.lobby.hostPlays')}
      </label>
      <label className="bingo__check">
        <input type="checkbox" checked={s.clock} onChange={(e) => save({ clock: e.target.checked })} />
        {i18n.t('draft.lobby.clock')}
      </label>
      {s.clock ? (
        <>
          <div className="bingo__rules-numbers">
            <label className="bingo__field">
              {i18n.t('draft.lobby.turnSeconds')}
              <input className="bingo__input" inputMode="numeric" value={turn} onChange={(e) => setTurn(e.target.value)}
                onBlur={() => save({})} />
            </label>
            <label className="bingo__field">
              {i18n.t('draft.lobby.bankMinutes')}
              <input className="bingo__input" inputMode="numeric" value={bank} onChange={(e) => setBank(e.target.value)}
                onBlur={() => save({})} />
            </label>
            <label className="bingo__field">
              {i18n.t('draft.lobby.incrementSeconds')}
              <input className="bingo__input" inputMode="numeric" value={increment}
                onChange={(e) => setIncrement(e.target.value)} onBlur={() => save({})} />
            </label>
          </div>
          <p className="bingo__note">{i18n.t('draft.lobby.noLimit')} {i18n.t('draft.lobby.clockHint')}</p>
        </>
      ) : (
        <p className="bingo__note">{i18n.t('draft.lobby.clockOff')}</p>
      )}
      <label className="bingo__check">
        <input type="checkbox" checked={s.duplicateCheck} onChange={(e) => save({ duplicateCheck: e.target.checked })} />
        {i18n.t('draft.lobby.duplicates')}
      </label>
      <p className="bingo__note">{i18n.t('draft.lobby.duplicatesHint')}</p>
    </fieldset>
  );
}

/** The rules as a player reads them in the lobby. */
function RulesSummary({ i18n, settings }: { i18n: PluginI18n; settings: DraftSettings }) {
  if (!settings.clock) return <p className="bingo__note">{i18n.t('draft.lobby.clockOff')}</p>;
  const parts: string[] = [];
  if (settings.turnSeconds !== null) parts.push(`${i18n.t('draft.lobby.turnSeconds')}: ${settings.turnSeconds}`);
  if (settings.bankSeconds !== null) parts.push(`${i18n.t('draft.lobby.bankMinutes')}: ${Math.round(settings.bankSeconds / 60)}`);
  if (settings.incrementSeconds) parts.push(`${i18n.t('draft.lobby.incrementSeconds')}: ${settings.incrementSeconds}`);
  return (
    <>
      <p className="bingo__note">{parts.join(' · ')}</p>
      <p className="bingo__note">{i18n.t('draft.lobby.clockHint')}</p>
    </>
  );
}

/** Inviting: a searchable list of people who've played here, and the link for everyone else. */
function Invite({
  ctx,
  i18n,
  view,
  onInvite,
}: {
  ctx: PluginContext;
  i18n: PluginI18n;
  view: DraftView;
  onInvite: (userIds: string[]) => Promise<string | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [candidates, setCandidates] = useState<UserRef[] | null>(null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = view.code ? inviteLink(window.location.origin, view.id, view.code) : null;

  const open = async () => {
    dialog.current?.showModal();
    setCandidates(null);
    setChosen([]);
    try {
      const answer = await ctx.actions!.call<{ userIds: string[] }>('draft-players', { id: view.id }, { scope: SITE });
      const people = await resolvePeople(ctx, answer?.userIds ?? []);
      setCandidates(Object.values(people).sort((a, b) => a.displayName.localeCompare(b.displayName)));
    } catch {
      setCandidates([]);
    }
  };
  const shown = (candidates ?? []).filter((p) => p.displayName.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="bingo__invite">
      <div className="bingo__actions">
        <button type="button" className="bingo__btn bingo__btn--quiet" onClick={() => void open()}>
          {i18n.t('draft.lobby.invite')}
        </button>
      </div>
      {view.quietEpisode && <p className="bingo__note">{i18n.t('draft.lobby.quietHint')}</p>}
      {link && (
        <div className="bingo__field">
          <span>{i18n.t('draft.lobby.link')}</span>
          <div className="bingo__share">
            <input className="bingo__input bingo__code" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button type="button" className="bingo__btn bingo__btn--quiet bingo__btn--small" onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                // The field is selectable; copying by hand still works.
              }
            }}>
              {copied ? i18n.t('draft.lobby.copied') : i18n.t('draft.lobby.copy')}
            </button>
          </div>
          <span className="bingo__note">{i18n.t('draft.lobby.linkHint')}</span>
        </div>
      )}
      <dialog ref={dialog} className="bingo__modal" aria-label={i18n.t('draft.lobby.invite')}>
        <div className="bingo__dialog-head">
          <p className="bingo__title">{i18n.t('draft.lobby.invite')}</p>
          <button type="button" className="bingo__btn bingo__btn--quiet bingo__btn--small" onClick={() => dialog.current?.close()}>
            {i18n.t('draft.lobby.close')}
          </button>
        </div>
        <p className="bingo__note">{i18n.t('draft.lobby.candidatesHint')}</p>
        {candidates === null ? (
          <p className="bingo__note">{i18n.t('common.loading')}</p>
        ) : candidates.length === 0 ? (
          <p className="bingo__note">{i18n.t('draft.lobby.noCandidates')}</p>
        ) : (
          <>
            <input className="bingo__input bingo__search" type="search" value={query}
              placeholder={i18n.t('draft.lobby.search')} aria-label={i18n.t('draft.lobby.search')}
              onChange={(e) => setQuery(e.target.value)} />
            <ul className="bingo__items bingo__invite-list">
              {shown.map((p) => (
                <li key={p.id} className="bingo__item">
                  <label className="bingo__check">
                    <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) =>
                      setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))} />
                    {p.displayName}
                  </label>
                </li>
              ))}
            </ul>
            <div className="bingo__actions">
              <button type="button" className="bingo__btn" disabled={busy || chosen.length === 0} onClick={async () => {
                setBusy(true);
                const failure = await onInvite(chosen);
                setBusy(false);
                if (!failure) dialog.current?.close();
              }}>
                {busy ? i18n.t('draft.lobby.sending') : i18n.t('draft.lobby.send')}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
