'use client';

import {Collapsible as CollapsiblePrimitive} from '@base-ui/react/collapsible';
import {mergeProps} from '@base-ui/react/merge-props';
import {useRender} from '@base-ui/react/use-render';
import {cva, type VariantProps} from 'class-variance-authority';
import {useEffect, useRef, useState} from 'react';
import {Icon, Check, ChevronRight, Close, Pending, Subtract} from '@/components/glaze/icon';
import {Status} from '@/components/glaze/ui/status';
import {cn} from '@/lib/glaze/utils';

// What the agent is doing now. One component with three looks, one per moment of a turn, in plain words throughout.
// The only shape is the pending arc, Glaze's one loop, which means "running"; a finished turn is words, and warn or
// fail add their word in the status colour.
//
// - waiting: the first gap of a turn, before any token, reasoning or tool call. The arc and a label ("Thinking"). It
//   appears only after `delay` ms and stays at least `minLoader` ms once shown, so a fast reply never flashes a loader
//   for one frame.
// - active: a live phrase ("Running eval") with the arc. A phrase holds at least `minDisplay` ms (1000 by default)
//   before the next replaces it; phrases that arrive in between are skipped, so a burst of tools reads as phrases, not
//   flicker. The new phrase cuts in; nothing crossfades.
// - done: a static past-tense label, or a summary of the whole turn ("Refunded 3 orders, ran an eval, 1 stopped"), with
//   its word when it warned or failed. Going inactive waits `settle` ms, so a tool that ends and the next that starts
//   read as one live phrase.
//
// ActivityGroup is the other piece: a quiet one-line summary ("Worked for 14s") with a caret that opens the rows it
// stands for, inline at their natural height. A step is a line of a checklist: StepGlyph, a 16px cell that holds the
// state (the arc while it runs, a check when done, a coral cross when it failed, a dash when denied or stopped), then
// the words. Every step has the cell, so the verbs of a list share one edge. Rows are flat: a wash under the pointer on
// the 6px tag corner, never glass, because opening a row shows, it does not act.
//
// The two formatters every agent piece shares live here too: formatElapsed (420ms, 1.2s, 2m 04s) and formatCount.

// ---------- Format ----------

/**
 * 420ms, 1.2s, 2m 04s, 2h 04m, 3d 02h: how long something took, as a clock reads. It rounds before it picks the unit,
 * so 999.6ms reads 1.0s and 59.96s reads 1m 00s, never 1000ms or 60.0s. A value that is not a finite number reads 0ms.
 */
function formatElapsed(ms: number) {
  const v = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (Math.round(v) < 1000) return `${Math.round(v)}ms`;
  const tenths = Math.round(v / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const secs = Math.round(v / 1000);
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${pad(secs % 60)}s`;
  const mins = Math.round(v / 60_000);
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ${pad(mins % 60)}m`;
  const hours = Math.round(v / 3_600_000);
  return `${Math.floor(hours / 24)}d ${pad(hours % 24)}h`;
}

/** A whole count with thousands separators: 1,284. */
function formatCount(n: number) {
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '0';
}

// ---------- Text ----------

type ActivityTextProps = useRender.ComponentProps<'span'> & {
  /** The work is running. Marks the element for state hooks; the text itself stays still. */
  active?: boolean;
};

/** A live phrase. It stays still in its own colour; the arc beside it shows the work is live. */
function ActivityText({active = true, className, render, children, ...props}: ActivityTextProps) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {className: cn(className), children},
      {'data-slot': 'activity-text', 'data-active': active || undefined} as React.ComponentProps<'span'>,
      props,
    ),
    render,
    state: {slot: 'activity-text', active},
  });
}

/** The pending arc on its own, 12px in a 16px cell, still under reduced motion. Hidden: a word beside it says running. */
function ActivityArc({className}: {className?: string}) {
  return <span aria-hidden data-slot="activity-arc" className={cn('flex size-4 shrink-0 items-center justify-center', className)}>
    <Icon icon={Pending} size={12} className="animate-spin motion-reduce:animate-none"/>
  </span>;
}

// ---------- Phrases ----------

const irregular: Record<string, string> = {
  running: 'ran', reading: 'read', writing: 'wrote', finding: 'found', building: 'built', sending: 'sent',
  getting: 'got', making: 'made', thinking: 'thought', setting: 'set', putting: 'put', cutting: 'cut',
  taking: 'took', giving: 'gave', seeing: 'saw', choosing: 'chose', bringing: 'brought', keeping: 'kept',
  leaving: 'left', holding: 'held', drawing: 'drew', spending: 'spent', splitting: 'split', telling: 'told',
  understanding: 'understood', rewriting: 'rewrote', rerunning: 'reran', rebuilding: 'rebuilt', resetting: 'reset',
  doing: 'did', going: 'went', paying: 'paid', saying: 'said', meeting: 'met', feeding: 'fed', winning: 'won',
  gathering: 'gathered',
};
const vowel = (ch: string | undefined) => !!ch && 'aeiou'.includes(ch);

/** "Searching docs" to "Searched docs". Handles -ing verbs and the irregulars agents use most. */
function pastTense(phrase: string): string {
  const [first, ...rest] = phrase.split(' ');
  const word = first.toLowerCase();
  if (!word.endsWith('ing') || word.length < 5) return phrase;
  const stem = word.slice(0, -3);
  const past = irregular[word] ?? (stem.endsWith('y') && !vowel(stem.at(-2)) ? `${stem.slice(0, -1)}ied` : `${stem}ed`);
  const cased = first[0] === first[0].toUpperCase() ? past[0].toUpperCase() + past.slice(1) : past;
  return [cased, ...rest].join(' ');
}

/** "Refunded 3 orders, ran an eval, 1 stopped". Done parts and trouble counts all join with commas. */
function joinSummary(done: string[], trouble: string[] = []) {
  const head = done.filter(Boolean).join(', ');
  const cased = head ? head[0].toUpperCase() + head.slice(1) : '';
  return [cased, ...trouble.filter(Boolean)].filter(Boolean).join(', ');
}

/** Minimum on-screen time for a phrase. */
const MIN_DISPLAY = 1000;

/** Holds each phrase for `hold` ms and keeps only the newest waiting one. */
function useHeldPhrase(label: string, active: boolean, hold: number) {
  const [shown, setShown] = useState(label);
  const shownAt = useRef(0);
  useEffect(() => {
    if (label === shown) return;
    if (!active) { setShown(label); shownAt.current = Date.now(); return; }
    const wait = Math.max(0, hold - (Date.now() - shownAt.current));
    const timer = setTimeout(() => { setShown(label); shownAt.current = Date.now(); }, wait);
    return () => clearTimeout(timer);
  }, [label, shown, active, hold]);
  return shown;
}

/** True while active, and for `settle` ms after, so a quick stop and start never flickers. */
function useSettled(active: boolean, settle: number) {
  const [live, setLive] = useState(active);
  useEffect(() => {
    if (active) { setLive(true); return; }
    const timer = setTimeout(() => setLive(false), settle);
    return () => clearTimeout(timer);
  }, [active, settle]);
  return active || live;
}

/**
 * Anti-flicker for loaders: turns true only after `show` has held for `delay` ms, and once true stays true for at least
 * `min` ms. A reply that lands in 80ms never shows the loader at all.
 */
function useAntiFlicker(show: boolean, delay = 150, min = 400) {
  const [visible, setVisible] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (show && !visible) {
      const t = setTimeout(() => { since.current = Date.now(); setVisible(true); }, delay);
      return () => clearTimeout(t);
    }
    if (!show && visible) {
      const t = setTimeout(() => setVisible(false), Math.max(0, min - (Date.now() - since.current)));
      return () => clearTimeout(t);
    }
  }, [show, visible, delay, min]);
  return visible;
}

// ---------- Activity ----------

type ActivityEnd = 'ok' | 'warn' | 'fail' | 'stopped';

type ActivityLabels = {
  /** The loader's label when `label` is not set. */
  thinking?: string;
  /** The done label of a stopped turn with no doneLabel. */
  stopped?: string;
  /** Read after the done label when the work warned, failed or stopped, unless the label already says so. */
  warnEnd?: string;
  failEnd?: string;
  stoppedEnd?: string;
};

const activityLabels: Required<ActivityLabels> = {
  thinking: 'Thinking', stopped: 'Stopped', warnEnd: 'with a warning', failEnd: 'failed', stoppedEnd: 'stopped',
};

const activityVariants = cva('relative flex w-fit max-w-full min-w-0 items-center text-start text-text-1', {
  variants: {
    size: {
      default: 'gap-1.5 type-label',
      sm: 'gap-1 type-body-sm',
    },
  },
  defaultVariants: {size: 'default'},
});

type ActivityProps = Omit<React.ComponentProps<'span'>, 'children'> & VariantProps<typeof activityVariants> & {
  /** The phrase for the work in progress, an -ing verb and its object: "Searching docs". */
  label?: string;
  /** Work is running now. */
  active?: boolean;
  /** Nothing has arrived yet this turn: shows the first-wait loader with `label` (default "Thinking"). */
  waiting?: boolean;
  /** The finished phrase or turn summary. Defaults to the past tense of the last live phrase. */
  doneLabel?: string;
  /** How the work ended. warn and fail add their word in the status colour; stopped is plain ink. */
  status?: ActivityEnd;
  /** Minimum ms a live phrase stays before the next replaces it. */
  minDisplay?: number;
  /** Ms to wait after going inactive before settling into the done label. */
  settle?: number;
  /** Ms the turn must wait before the loader shows. Defaults to --wait-show, 150. */
  delay?: number;
  /** Minimum ms the loader stays once shown. Defaults to --wait-hold, 400. */
  minLoader?: number;
  /** Owns a polite status region that reads the settled phrase. Pass false inside a Conversation, which makes the one
   *  announcement per turn end itself. */
  announce?: boolean;
  /** The default words, for another language. */
  labels?: ActivityLabels;
};

function Activity({
  label, active = false, waiting = false, doneLabel, status = 'ok', size = 'default',
  minDisplay = MIN_DISPLAY, settle = 400, delay = 150, minLoader = 400, announce = true, labels, className, ...props
}: ActivityProps) {
  const words = {...activityLabels, ...labels};
  const loader = useAntiFlicker(waiting, delay, minLoader);
  const live = useSettled(active, settle);
  const phrase = useHeldPhrase(label ?? '', live, minDisplay);
  const state = loader ? 'waiting' : live ? 'active' : waiting || (!label && !doneLabel) ? 'idle' : 'done';
  // The new phrase replaces the old one in place: a cut, never a crossfade.
  const text = state === 'waiting' ? (label ?? words.thinking)
    : state === 'active' ? phrase
      : state === 'idle' ? ''
        : (doneLabel ?? (status === 'stopped' ? words.stopped : pastTense(phrase)));

  // The end word is skipped when the summary already says it ("1 stopped").
  const end = {ok: '', warn: words.warnEnd, fail: words.failEnd, stopped: words.stoppedEnd}[status];
  const said = end && !text.toLowerCase().includes(end.toLowerCase().replace(/^with a /, '')) ? `, ${end}` : '';
  const announced = state === 'done' ? `${text}${said}` : state === 'waiting' ? text : '';
  const moving = state === 'active' || state === 'waiting';
  const trouble = state === 'done' && (status === 'warn' || status === 'fail');

  return <span
    data-slot="activity"
    data-state={state}
    data-size={size}
    aria-busy={moving || undefined}
    className={cn(activityVariants({size}), className)}
    {...props}
  >
    {moving && <ActivityArc className="text-text-2"/>}
    <ActivityText active={moving} className={cn('min-w-0 truncate', state === 'done' && 'text-text-2')}>{text}</ActivityText>
    {trouble && <Status status={status} size={size === 'sm' ? 'sm' : 'default'} className="shrink-0" aria-hidden/>}
    {/* One polite region: the loader's label and the settled phrase. Live phrases are not read out. */}
    {announce && <span role="status" className="sr-only">{announced}</span>}
  </span>;
}

// ---------- Group ----------

type ActivityItem = {id: string; label: string; status: 'pending' | 'running' | 'ok' | 'fail' | 'stopped' | 'denied' | 'waiting'};

/**
 * Which item the header follows: the newest running one, else the last that did not fail, else the last. A failed call
 * never becomes the headline while something else succeeded after it.
 */
function pickActivity<T extends Pick<ActivityItem, 'status'>>(items: readonly T[]): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].status === 'running' || items[i].status === 'pending' || items[i].status === 'waiting') return items[i];
  for (let i = items.length - 1; i >= 0; i--) if (items[i].status !== 'fail') return items[i];
  return items.at(-1);
}

type StepState = 'running' | 'done' | 'fail' | 'stopped';

/**
 * The state of one step in a 16px cell: the arc while it runs, a check in text-3 when it is done, a coral cross when it
 * failed, a dash when it was denied or stopped. The cell is always there, so verbs line up whatever the state. Hidden
 * from assistive tech: the row says its state in words.
 */
function StepGlyph({state, className}: {state: StepState; className?: string}) {
  if (state === 'running') return <ActivityArc className={cn('text-text-2', className)}/>;
  return <span aria-hidden data-slot="step-glyph" data-state={state} className={cn('flex size-4 shrink-0 items-center justify-center', className)}>
    {state === 'done' ? <Icon icon={Check} size={12} className="text-text-3"/>
      : state === 'fail' ? <Icon icon={Close} size={12} className="text-fail-text"/>
        : <Icon icon={Subtract} size={12} className="text-text-3"/>}
  </span>;
}

/** The caret of a row that opens, in a 16px cell, turning a quarter when open. A row that does not open draws nothing. */
function Disclosure({open, end = false}: {open: boolean; end?: boolean}) {
  if (end && !open) return null;
  return <span aria-hidden data-slot="disclosure" data-end={end || undefined} className="flex size-4 shrink-0 items-center justify-center text-text-3">
    {open && <Icon icon={ChevronRight} size={12} className="transition-[rotate] duration-(--dur-state) ease-out group-data-panel-open/row:rotate-90 motion-reduce:transition-none rtl:-scale-x-100 rtl:group-data-panel-open/row:-rotate-90"/>}
  </span>;
}

/**
 * The shared line of a tool row, a reasoning trigger and a group summary: 32px (28 small), a 16px cell at the start,
 * then the words with the time right after them. It is only as wide as what it says, never a full-width bar with the
 * time pushed to the far edge. It bleeds 8px into the gutter so the cell sits on the text's edge and the wash has room.
 * Only a row that opens gets the wash; it is flat, on the 6px tag corner of a row.
 */
const rowVariants = cva('group/row -mx-2 flex max-w-[calc(100%+var(--space-4))] min-w-0 items-center gap-2 self-start rounded-tag px-2 text-start type-body-sm focus-visible:focus-ring-inset pointer-coarse:min-h-11', {
  variants: {
    size: {default: 'min-h-(--control)', sm: 'min-h-(--menu-row-sm)'},
    opens: {true: 'transition-colors duration-(--dur-state) ease-out hover:bg-hover active:bg-pressed', false: ''},
  },
  defaultVariants: {size: 'default', opens: true},
});

type ActivityGroupProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** The one line that stands for the rows: "Worked for 14s", "Looked up 2 orders, searched once". */
  summary: React.ReactNode;
  /** The end of the line: a duration in text-3, or a failed count. Live with no meta shows the arc. */
  meta?: React.ReactNode;
  /** Rows are arriving. */
  live?: boolean;
  /** The rows. Hidden until the line opens. */
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: 'default' | 'sm';
};

/**
 * A summary line over rows. It starts closed: the caret opens the rows inline at their natural height, under the
 * words, with no frame and no inner scroll.
 */
function ActivityGroup({summary, meta, live = false, open, defaultOpen = false, onOpenChange, size = 'default', className, children, ...props}: ActivityGroupProps) {
  const {force, rest} = splitForce(props);
  return <CollapsiblePrimitive.Root
    data-slot="activity-group"
    data-live={live || undefined}
    open={open}
    defaultOpen={defaultOpen}
    onOpenChange={onOpenChange}
    className={cn('flex min-w-0 flex-col', className)}
    {...rest}
  >
    <CollapsiblePrimitive.Trigger data-slot="activity-group-trigger" className={rowVariants({size})} {...force}>
      <Disclosure open/>
      <span data-slot="activity-group-summary" className="min-w-0 truncate text-text-2">{summary}</span>
      <span data-slot="activity-group-meta" className="flex shrink-0 items-center gap-2 text-text-2 data empty:hidden">
        {meta ?? (live ? <ActivityArc/> : null)}
      </span>
    </CollapsiblePrimitive.Trigger>
    <CollapsiblePrimitive.Panel data-slot="activity-group-content" className="flex min-w-0 flex-col ps-6">
      {children}
    </CollapsiblePrimitive.Panel>
  </CollapsiblePrimitive.Root>;
}

/** Moves the docs' forced states (data-force-*) from a root to the row inside it, where hover, focus and press live. */
function splitForce<T extends Record<string, unknown>>(props: T) {
  const force: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) (k.startsWith('data-force-') ? force : rest)[k] = v;
  return {force, rest: rest as T};
}

export {
  Activity, ActivityText, ActivityArc, ActivityGroup, Disclosure, StepGlyph, pastTense, joinSummary, pickActivity, useAntiFlicker,
  useHeldPhrase, splitForce, formatElapsed, formatCount, MIN_DISPLAY, activityVariants, rowVariants,
  type ActivityProps, type ActivityLabels, type ActivityTextProps, type ActivityEnd, type ActivityItem, type ActivityGroupProps, type StepState,
};
