// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useMemo, useRef, useState } from 'react';
import { isPluginApiError, type PluginContext } from '@mosaicast/plugin-sdk';
import { makeI18n } from '../i18n';
import { Icon } from '../icons';
import { KEY_CLAIM, KEY_CONTROL, KEY_IMPORTS, KEY_PREFS, cardKey } from '../keys';
import {
  countsTowardsRanking,
  fillableCells,
  gridSize,
  hasFreeCentre,
  hitGrid,
  canEditCard,
  isFinalSubmission,
  countLines,
  DEFAULT_FUZZY_THRESHOLD,
  lineCount,
  prefOrDefault,
  type ClaimDoc,
  type Imports,
  type Leaderboard,
  type Phase,
  type RankBy,
} from '../types';
import { cardIssues } from '../fuzzy';
import { BingoGrid } from './BingoGrid';
import { CardChecks, blocksSaving } from './CardChecks';
import { SuggestionChips } from './SuggestionChips';
import { CreatePanel } from './CreatePanel';
import { Shell, nameOf, toRef } from './common';
import { PodcasterActions } from './PodcasterActions';
import { RecapPanel } from './RecapPanel';
import { Results } from './Results';
import { ShareButton } from './ShareButton';
import { FeatureModal } from './FeatureModal';
import { ResolveModal, undecided } from './ResolveModal';
import { pick, readScope, useBingo, type BingoData } from './useBingo';
import { copyClaimedCards } from '../claimCards';


const PHASE_ICON: Record<Phase, 'clock' | 'lock' | 'check' | 'board'> = {
  OPEN: 'clock',
  LOCKED: 'lock',
  RESOLVED: 'check',
  ARCHIVED: 'board',
};

/**
 * The episode tile: the featured cards, the viewer's own, and the results.
 *
 * The lifecycle shown here comes from the backend-published `phase` document, never from `ctx.episode`.
 * Since core 0.7.7 that field is filled, but it says where the *episode* stands, not the bingo: a podcaster
 * may lock before the release or reopen after it, and only the backend merges that intent with the release.
 */
export function EpisodeBingo({ ctx }: { ctx: PluginContext }) {
  // Keyed on the locale handle, not on `ctx`: the element hands this component every new context in place
  // (MosaicastHandle.update), and a translator rebuilt for each one would drop its locale subscription
  // and re-render the whole tile for a change that had nothing to do with language.
  const i18n = useMemo(() => makeI18n(ctx.locale), [ctx.locale]);
  useEffect(() => () => i18n.dispose(), [i18n]);

  const data = useBingo(ctx);
  const [tab, setTab] = useState<string>('me');
  const [draft, setDraft] = useState<string[] | null>(null);
  const [listed, setListed] = useState(true);
  const [showcasable, setShowcasable] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [focused, setFocused] = useState<number | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [revealed, setRevealed] = useState(false);
  const [unheard, setUnheard] = useState(false);
  const [modal, setModal] = useState<'resolve' | 'catchup' | 'feature' | null>(null);
  const [linking, setLinking] = useState(false);
  const copied = useRef<string | null>(null);

  const size = gridSize(data.template);
  const freeCentre = hasFreeCentre(data.template);
  const rankBy: RankBy = data.leaderboard?.rankBy === 'fields' ? 'fields' : 'lines';
  const phase: Phase = data.phase?.phase ?? 'OPEN';
  // The podcaster's intent lands at once; the derived phase follows on the backend's next pass. Saying so
  // is the difference between a button that looks broken and one that is simply waiting.
  const awaiting = data.intent && data.intent !== phase ? data.intent : null;
  const mayEdit = ctx.user?.role === 'podcaster' || ctx.user?.role === 'admin';

  // Spoiler protection is a courtesy, not access control: `ctx.progress` reads this browser's own stored
  // position, so it knows nothing about the same person on another device.
  useEffect(() => {
    let live = true;
    ctx.progress
      .get(ctx.scope.id)
      .then((seconds) => {
        if (live) setUnheard(seconds === null || seconds < 30);
      })
      .catch(() => {
        if (live) setUnheard(false);
      });
    return () => {
      live = false;
    };
    // What the read depends on, rather than the context object that happens to carry it — so a new ctx for
    // an unrelated reason does not re-read listening progress.
  }, [ctx.progress, ctx.scope.id]);

  useEffect(() => {
    if (data.loading) return;
    setDraft(normalise(data.myCard?.entries ?? [], fillableCells(size, freeCentre)));
    // Prefilled with whatever they decided last time, so the question is asked once and then remembered.
    setListed(prefOrDefault(data.myPrefs?.listed));
    setShowcasable(prefOrDefault(data.myPrefs?.showcasable));
    setShowSuggestions(prefOrDefault(data.myPrefs?.suggestions));
  }, [data.loading, data.myCard, data.myPrefs, size, freeCentre]);

  // A claimed card is on the record but not in the viewer's partition, where the tile draws it from; only
  // this browser can put it there (see claimCards.ts). Once per episode, and only when it could apply.
  const phaseNow = data.phase?.phase;
  useEffect(() => {
    const done = phaseNow === 'RESOLVED' || phaseNow === 'ARCHIVED';
    if (data.loading || !ctx.user || data.myCard || !done || copied.current === ctx.scope.id) return;
    copied.current = ctx.scope.id;
    let live = true;
    (async () => {
      const [site, claim] = await Promise.all([
        readScope(ctx, { type: 'site', id: 'main' }, [KEY_IMPORTS]),
        ctx.docs.get<ClaimDoc>('self', KEY_CLAIM),
      ]);
      const imports = pick<Imports>(site, KEY_IMPORTS);
      if (!imports?.claimed || !claim?.codes?.length || !live) return;
      setLinking(true);
      const written = await copyClaimedCards(ctx, imports, claim, ctx.scope.id);
      if (!live) return;
      setLinking(false);
      if (written.length > 0) data.reload();
    })().catch((error: unknown) => {
      if (live) setLinking(false);
      ctx.log('warn', `bingo: could not copy a claimed card (${String(error)})`);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on what decides whether it applies
  }, [data.loading, data.myCard, phaseNow, ctx.scope.id, ctx.user?.id]);

  if (data.loading) return <Shell>{i18n.t('common.loading')}</Shell>;
  if (data.failed) return <Shell>{i18n.t('common.error')}</Shell>;

  if (!data.template) {
    return (
      <Shell>
        <p className="bingo__note">{i18n.t('episode.noBingo')}</p>
        {mayEdit && <CreatePanel ctx={ctx} i18n={i18n} onCreated={data.reload} />}
      </Shell>
    );
  }

  // The podcaster sees their own ticks as they make them; everyone else sees the answers the backend
  // publishes at RESOLVED. The host never hands `resolution` to anyone below podcaster.
  const truth = data.resolution?.hits ?? data.answers?.hits ?? {};
  const hitsFor = (entries: string[]) =>
    entries.map((text) => {
      const canonical = data.assignments[text.trim()];
      return Boolean(canonical && truth[canonical]);
    });

  // Blur only when there is something to give away. A locked bingo whose answers nobody has ticked off yet
  // spoils nothing, and blurring it would hide the tile's whole point from every first-time visitor.
  const hasSpoilers = Object.values(truth).some(Boolean);
  // Covers what someone else predicted, and the recap. Never the viewer's own card: they played it, and the
  // hits on it are their own result, not news about the episode.
  const spoilersCovered = hasSpoilers && unheard && !revealed;

  const save = async () => {
    if (!draft) return;
    setSaving('saving');
    try {
      // Preferences first: if the card lands and the choice does not, the backend would publish them under
      // an assumption they had just tried to change.
      await ctx.docs.put(
        'self',
        KEY_PREFS,
        { listed, showcasable, suggestions: showSuggestions, updatedAt: new Date().toISOString() },
      );
      // The card only when it may still change: after the freeze this button saves the choices alone.
      if (editable) {
        await ctx.docs.put('self', cardKey(ctx.scope.id), { entries: draft.map((e) => e.trim()) });
      }
      setSaving('saved');
      data.reload();
    } catch (error) {
      setSaving('idle');
      ctx.log(
        'warn',
        `bingo: could not save this card (${isPluginApiError(error) ? error.status : String(error)})`,
      );
    }
  };

  /**
   * Saved the moment it is flipped, on its own: it is about this person's screen, not about their card,
   * so it should not wait for — or ride along with — a card save. Only the stored choices are written
   * back next to it, never toggles the player has changed and not saved yet.
   */
  const toggleSuggestions = async (next: boolean) => {
    setShowSuggestions(next);
    try {
      await ctx.docs.put('self', KEY_PREFS, {
        ...(data.myPrefs ?? {}),
        suggestions: next,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      ctx.log(
        'warn',
        `bingo: could not save the suggestions choice (${isPluginApiError(error) ? error.status : String(error)})`,
      );
    }
  };

  const tabs = [
    // A featured card that belongs to the viewer is dropped here rather than drawn twice: their own tab
    // below already shows that card, and is the one carrying the editor and the visibility choices. Being
    // featured is a thing other people see, so it should not split the owner's card into two tabs.
    ...data.showcased
      .filter((card) => card.userId !== ctx.user?.id)
      .map((card) => ({
        id: card.userId,
        label: nameOf(data.people[card.userId], i18n),
        entries: card.entries ?? [],
        person: data.people[card.userId],
      })),
    { id: 'me', label: i18n.t('episode.yourCard'), entries: draft ?? [], person: undefined },
  ];
  /** One card's standing, led by whatever the site ranks on. */
  const scoreLabel = (entries: string[]) => {
    const grid = hitGrid(hitsFor(entries), size, freeCentre);
    return rankBy === 'fields'
      ? i18n.t('card.fields', {
          fields: String(grid.filter(Boolean).length),
          cells: String(size * size),
        })
      : i18n.t('card.lines', {
          lines: String(countLines(grid, size)),
          ofLines: String(lineCount(size)),
        });
  };

  const active = tabs.find((t) => t.id === tab) ?? tabs[tabs.length - 1];
  const hideForSpoilers = spoilersCovered && active.id !== 'me';
  const signedIn = Boolean(ctx.user);
  const hasCard = Boolean(data.myCard);
  // A card can be on the record without being in the viewer's partition yet: one imported and claimed,
  // until it has been copied in. Offering a late card then would be a control the backend ignores.
  const onRecord =
    hasCard || linking || [...(data.leaderboard?.ranked ?? []), ...(data.leaderboard?.late ?? [])].some(
      (r) => r.author === ctx.user?.id,
    );
  const allowLate = data.phase?.allowLate !== false;
  // Editable while predictions are open; after that only a card that does not exist yet, and then once.
  const editable = active.id === 'me' && signedIn && canEditCard(phase, onRecord, allowLate);
  const finalSubmission = editable && isFinalSubmission(phase);
  // A standing choice about how you appear, not part of the card — so it stays changeable after the freeze.
  const canChoose = active.id === 'me' && signedIn && phase !== 'ARCHIVED';
  // Two of the player's own squares that would count as one, worked out here as they type — no request.
  const threshold = data.phase?.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD;
  const issues = editable && draft ? cardIssues(draft, threshold) : [];
  const blocked = blocksSaving(issues);

  return (
    <Shell>
      <div className="bingo__head">
        <h3 className="bingo__title">{data.template.title || i18n.t('episode.title')}</h3>
        <span className="bingo__phase">
          <Icon name={PHASE_ICON[phase]} />
          {i18n.t(`phase.${phase.toLowerCase()}`)}
        </span>
      </div>
      <p className="bingo__hint">{i18n.t(`phase.${phase.toLowerCase()}Hint`)}</p>
      {awaiting && (
        <p className="bingo__warn">
          {i18n.t('phase.awaiting', { phase: i18n.t(`phase.${awaiting.toLowerCase()}`) })}
        </p>
      )}

      {finalSubmission && <p className="bingo__warn">{i18n.t('late.warning')}</p>}
      {active.id === 'me' && signedIn && !editable && hasCard && phase !== 'ARCHIVED' && (
        <p className="bingo__note">{i18n.t('episode.frozen')}</p>
      )}
      {active.id === 'me' && signedIn && !hasCard && onRecord && (
        <p className="bingo__note">{i18n.t('episode.linking')}</p>
      )}

      <div className="bingo__tabs" role="tablist" aria-label={i18n.t('episode.cards')}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="bingo__tab"
            aria-selected={t.id === active.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}{' '}
            <span className="bingo__tab-score">{scoreLabel(t.entries)}</span>
          </button>
        ))}
      </div>

      {hideForSpoilers ? (
        <div className="bingo__spoiler">
          <p className="bingo__title">{i18n.t('episode.spoilerTitle')}</p>
          <p className="bingo__note">{i18n.t('episode.spoilerBody')}</p>
          <button type="button" className="bingo__btn bingo__btn--quiet" onClick={() => setRevealed(true)}>
            {i18n.t('episode.spoilerReveal')}
          </button>
        </div>
      ) : (
        <>
          {editable && draft && (
            <SuggestionChips
              i18n={i18n}
              suggestions={data.suggestions}
              vocabulary={data.vocabulary}
              draft={draft}
              threshold={threshold}
              shown={showSuggestions}
              onToggle={toggleSuggestions}
              onPick={(text) =>
                setDraft((current) => {
                  const next = [...(current ?? [])];
                  // The square the player was last in, if it is still empty; otherwise the first empty one.
                  const slot =
                    focused !== null && !next[focused]?.trim() ? focused : next.findIndex((e) => !e.trim());
                  if (slot === -1) return next; // every square is taken
                  next[slot] = text;
                  setSaving('idle');
                  return next;
                })
              }
            />
          )}
          {editable && <p className="bingo__note">{i18n.t('episode.entryPlaceholder')}</p>}
          <BingoGrid
            size={size}
            freeCentre={freeCentre}
            entries={active.entries}
            hits={hitsFor(active.entries)}
            i18n={i18n}
            label={active.label}
            flags={Object.fromEntries(issues.map((issue) => [issue.index, issue.kind]))}
            onFocusCell={setFocused}
            onChange={
              editable
                ? (index, value) =>
                    setDraft((current) => {
                      const next = [...(current ?? [])];
                      next[index] = value;
                      setSaving('idle');
                      return next;
                    })
                : undefined
            }
          />
          <CardChecks issues={issues} i18n={i18n} />
        </>
      )}

      {active.id === 'me' && !hideForSpoilers && (
        <>
          {!ctx.user && <p className="bingo__note">{i18n.t('episode.signInToPlay')}</p>}
          {canChoose && (
            <>
              <div className="bingo__prefs">
                <label className="bingo__check">
                  <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
                  {i18n.t('prefs.listed')}
                </label>
                <label className="bingo__check">
                  <input
                    type="checkbox"
                    checked={showcasable}
                    onChange={(e) => setShowcasable(e.target.checked)}
                  />
                  {i18n.t('prefs.showcasable')}
                </label>
                <p className="bingo__note">{i18n.t('prefs.hint')}</p>
              </div>
              <div className="bingo__actions">
                <button
                  type="button"
                  className="bingo__btn"
                  onClick={save}
                  disabled={saving === 'saving' || blocked}
                >
                  {saving === 'saving'
                    ? i18n.t('episode.saving')
                    : !editable
                      ? i18n.t('episode.saveChoices')
                      : finalSubmission
                        ? i18n.t('episode.submit')
                        : i18n.t('episode.save')}
                </button>
                {saving === 'saved' && <span className="bingo__note">{i18n.t('episode.saved')}</span>}
              </div>
              {editable && !finalSubmission && (
                <p className="bingo__note">{i18n.t('episode.editableUntilLock')}</p>
              )}
            </>
          )}
        </>
      )}

      {mayEdit && (
        <PodcasterActions
          i18n={i18n}
          phase={phase}
          awaiting={awaiting}
          pending={undecided(data.candidates, data.resolution).length}
          onOpen={setModal}
          onMove={async (to) => {
            try {
              await ctx.docs.put(ctx.scope, KEY_CONTROL, {
                phase: to,
                updatedAt: new Date().toISOString(),
              });
              data.reload();
            } catch (error) {
              // Previously this rejected into nothing: the button looked exactly as dead on a refusal as it
              // did while waiting for the next pass.
              ctx.log(
                'warn',
                `bingo: could not change the phase (${
                  isPluginApiError(error) ? error.status : String(error)
                })`,
              );
            }
          }}
        />
      )}
      {modal === 'feature' && (
        <FeatureModal
          ctx={ctx}
          i18n={i18n}
          participants={data.participants}
          people={data.people}
          picked={data.showcasePick}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            data.reload();
          }}
        />
      )}
      {(modal === 'resolve' || modal === 'catchup') && (
        <ResolveModal
          ctx={ctx}
          i18n={i18n}
          candidates={data.candidates}
          cardCounts={data.cardCounts}
          assignments={data.assignments}
          grouping={data.grouping}
          resolution={data.resolution}
          mode={modal}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            data.reload();
          }}
          onRegroup={data.reload}
        />
      )}

      <Results
        i18n={i18n}
        // The reader's own row can be one the board does not carry (opted out, or past the cap), so their
        // id was never resolved. `ctx.user` already says who they are — read at render, never stored — and
        // stands in only where the directory gave no answer.
        people={ctx.user ? { [ctx.user.id]: toRef(ctx.user), ...data.people } : data.people}
        me={ctx.user?.id}
        board={data.leaderboard}
        size={size}
        hidden={Boolean(ctx.user) && !listed}
        // Not gated on `listed`. Someone who opted out has no published row by definition, which makes
        // them exactly the reader the tally is published for — and this row is drawn from their own card
        // in their own browser, so showing them their place tells nobody else anything.
        // Only for someone who handed a card in: a reader who never played has an all-blank draft, and
        // would otherwise be placed on the board with the free centre as their score.
        mine={
          ctx.user && hasCard && draft
            ? (() => {
                const grid = hitGrid(hitsFor(draft), size, freeCentre);
                return { fields: grid.filter(Boolean).length, lines: countLines(grid, size) };
              })()
            : undefined
        }
        rankBy={rankBy}
      />
      {/* It names what happened in the episode, so it sits behind the same cover as the grid. */}
      {data.recap?.published && spoilersCovered ? (
        <div className="bingo__spoiler">
          <p className="bingo__note">{i18n.t('episode.spoilerBody')}</p>
          <button type="button" className="bingo__btn bingo__btn--quiet" onClick={() => setRevealed(true)}>
            {i18n.t('episode.spoilerReveal')}
          </button>
        </div>
      ) : (
        <RecapPanel recap={data.recap} i18n={i18n} />
      )}
      <div className="bingo__actions">
        {/* A player's own result only once the published board carries it — the backend answers for that
            page and no other; everyone else shares the bingo itself. */}
        <ShareButton
          ctx={ctx}
          i18n={i18n}
          subpath={
            ctx.user && data.leaderboard?.published && onBoard(data.leaderboard, ctx.user.id)
              ? `e/${ctx.scope.id}/u/${ctx.user.id}`
              : `e/${ctx.scope.id}`
          }
          title={data.template.title || i18n.t('episode.title')}
        />
      </div>
    </Shell>
  );
}

/** Whether the published board carries this person's row, ranked or late. */
function onBoard(board: Leaderboard, id: string): boolean {
  return [...(board.ranked ?? []), ...(board.late ?? [])].some((row) => row.author === id);
}

/** A card always renders `count` squares, however many entries were actually written. */
function normalise(entries: string[], count: number): string[] {
  const next = entries.slice(0, count);
  while (next.length < count) next.push('');
  return next;
}

export type { BingoData };
