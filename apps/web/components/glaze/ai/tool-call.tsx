'use client';

import {Collapsible as CollapsiblePrimitive} from '@base-ui/react/collapsible';
import {useCallback, useEffect, useId, useMemo, useReducer, useRef, useState} from 'react';
import {Button} from '@/components/glaze/ui/button';
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from '@/components/glaze/ui/card';
import {statusLabels} from '@/components/glaze/ui/status';
import {ActivityGroup, Disclosure, StepGlyph, formatCount, formatElapsed, joinSummary, pastTense, pickActivity, rowVariants, splitForce, type ActivityEnd, type StepState} from '@/components/glaze/ai/activity';
import {RequestSummary, RequestTicker, ShowMoreRow, summarizeRequests, type TickerRequest} from '@/components/glaze/ai/request-ticker';
import {cn, mergeRefs} from '@/lib/glaze/utils';

// One tool call as a quiet line that can grow. It starts as one line the moment the model names the tool ("Preparing
// edit") and upgrades to a body as its metadata arrives: the command's output for a shell, the patch for an edit.
//
// A row is a step of a checklist and has one anatomy in every state: a 16px glyph cell for the state (the arc while it
// runs, a check in text-3 when done, a coral cross when it failed, a dash when denied or stopped), the verb in text-2,
// the target in mono at 0.8 (it truncates first, and wraps to a second line on a phone), the duration in text-3, then a
// caret when the row has a body. A row with a body is a button, the whole line is the hit target, and its body opens
// inline under the verb, in the well (the grey field Glaze keeps for output). A row with no body is plain text: no
// caret, no wash. Rows are flat: opening one shows, it does not act, so no glass.
//
// Seven states:
//   pending              the model is still streaming the arguments; "Preparing" with the arc
//   running              the tool is executing; the -ing verb with the arc
//   completed            the verb in the past tense and the duration
//   error                a coral "Failed" at the end; the message is the body, open
//   awaiting-permission  the run is paused on the person: the card, its question as the title, one sentence of what it
//                        does and the detail in full in a well, then a flat Deny and the one green Allow on the shell's
//                        footer row. Green, because Allow says yes to something proposed. Answered, it becomes a normal
//                        row in the same place, and the row takes focus.
//   denied               the person said no: a quiet "Denied" where the verb was. A decision is not an error, so it
//                        stays in text-2
//   cancelled            the turn was stopped while this ran; "Stopped"
// The last four, with completed, are terminal and absorb: no later event reopens or relabels them.
//
// ToolCallList is the turn's rows. While the turn is live, the completed calls before the current one fold into one
// line ("Read 2 files, searched once"); when it is done, all of them fold into "Worked for 14s".
//
// Events carry a per-call `seq`. A duplicate or out-of-order event is dropped and counted. A result that arrives
// before its call is kept as an orphan, held back for `orphanTtl` ms in case the call is just late, then shown as an
// orphaned result, never as a success. An end with no status is an error, never a success.
//
// Stop is generation-keyed. Every turn has a generation; stop names the one it stops (`gen` is required) and settles
// that turn's live calls to cancelled. After it an event tagged with that generation or an older one drops; an event
// with no gen counts as the stopped turn's until a new turn opens (an event with a newer gen, or {type: 'turn'}); a stop
// for an older generation (a late echo) drops, so it can never cancel the next turn.
//
// Per-tool renderers come from a registry with aliases (bash and sh are shell; apply_patch and write are edit).
// Anything unregistered gets the generic renderer: the first useful argument as the detail and up to 3 scalars in the
// body. Output shows 24 lines of a shell and 8 of anything else before "Show more", and 20,000 characters in all.

// ---------- Data ----------

type ToolStatus = 'pending' | 'running' | 'completed' | 'error' | 'awaiting-permission' | 'denied' | 'cancelled';

const terminal: ReadonlySet<ToolStatus> = new Set(['completed', 'error', 'denied', 'cancelled']);
const isTerminal = (status: ToolStatus) => terminal.has(status);

/** What the person answers an ask with: allow it, or refuse. */
type ToolReply = 'once' | 'reject';

type ToolCallData = {
  id: string;
  /** The tool's name as the model called it: bash, read, deploy.create. */
  tool: string;
  status: ToolStatus;
  input?: Record<string, unknown>;
  /** The partial argument JSON while pending. */
  raw?: string;
  /** A title the tool reported, shown as the detail when the renderer has none. */
  title?: string;
  /** Live data from the tool: output while running, diff, counts. */
  metadata?: Record<string, unknown>;
  output?: string;
  error?: string;
  /** What the run asks permission for: `patterns` fill the card's well when the input has no command, and `message` is
   *  the one sentence under the question that says what allowing does. */
  permission?: {patterns: string[]; message?: string};
  /** The person's feedback when they denied it. */
  reason?: string;
  startedAt?: number;
  endedAt?: number;
  /** The last event applied. Events at or below it are dropped. */
  seq: number;
  /** A result that arrived before its call. */
  orphan?: boolean;
  receivedAt?: number;
};

/** `gen` is the turn's generation. Without it, the event belongs to the current turn. */
type Seq = {seq: number; id: string; gen?: number; at?: number};
type ToolEvent =
  | (Seq & {type: 'call'; tool: string; input?: Record<string, unknown>; raw?: string})
  | (Seq & {type: 'input'; raw: string; input?: Record<string, unknown>})
  | (Seq & {type: 'start'; tool?: string; input?: Record<string, unknown>; title?: string})
  | (Seq & {type: 'progress'; metadata?: Record<string, unknown>; title?: string})
  | (Seq & {type: 'ask'; patterns: string[]; message?: string})
  | (Seq & {type: 'reply'; reply: ToolReply; feedback?: string})
  | (Seq & {type: 'result'; tool?: string; status?: 'completed' | 'error'; output?: string; error?: string; title?: string; metadata?: Record<string, unknown>})
  /** Stops turn `gen`: its live calls settle to cancelled and its late events drop. */
  | {type: 'stop'; gen: number; at?: number}
  /** Opens a new turn: `gen`, or the next generation. Untagged events are accepted again. */
  | {type: 'turn'; gen?: number}
  | {type: 'reset'};

type ToolCallsState = {
  calls: ToolCallData[];
  /** The current turn's generation. Events tagged with an older one are dropped. */
  gen: number;
  /** The current turn was stopped: its events, and untagged events, drop until a new turn opens. */
  stopped?: boolean;
  /** Events dropped as duplicate, out of order, stale or against a terminal state. */
  dropped: number;
};

const emptyState: ToolCallsState = {calls: [], gen: 0, stopped: false, dropped: 0};
const NO_STATUS = 'The tool ended without reporting a result.';
/** Characters a collapsed output shows per line of its cap, so one long line cannot fill the thread. */
const CHARS_PER_LINE = 120;

/** An event's time in epoch ms, or now when it has none or it is not a finite number. */
const timeOf = (at: number | undefined) => typeof at === 'number' && Number.isFinite(at) ? at : Date.now();

function transition(call: ToolCallData, e: Exclude<ToolEvent, {type: 'stop' | 'reset' | 'turn'}>): ToolCallData {
  const at = timeOf(e.at);
  switch (e.type) {
    case 'call': return {...call, tool: e.tool, input: e.input ?? call.input, raw: e.raw ?? call.raw, status: 'pending'};
    case 'input': return {...call, raw: e.raw, input: e.input ?? call.input};
    case 'start': return {...call, tool: e.tool ?? call.tool, input: e.input ?? call.input, title: e.title ?? call.title, status: 'running', startedAt: call.startedAt ?? at};
    case 'progress': return {...call, metadata: {...call.metadata, ...e.metadata}, title: e.title ?? call.title, status: call.status === 'pending' ? 'running' : call.status, startedAt: call.startedAt ?? at};
    case 'ask': return {...call, status: 'awaiting-permission', permission: {patterns: e.patterns, message: e.message}};
    case 'reply': return e.reply === 'reject'
      ? {...call, status: 'denied', reason: e.feedback, endedAt: at}
      : {...call, status: 'running', startedAt: call.startedAt ?? at};
    case 'result': {
      const status = e.status ?? 'error';
      return {
        ...call, status, output: e.output ?? call.output, title: e.title ?? call.title,
        metadata: e.metadata ? {...call.metadata, ...e.metadata} : call.metadata,
        error: status === 'error' ? (e.error ?? (e.status ? 'The tool failed.' : NO_STATUS)) : undefined,
        endedAt: at,
      };
    }
  }
}

/**
 * The one reducer every view uses, so a call reads the same in a chat, a console and a canvas. Monotonic per call,
 * terminal states absorb, results before calls are kept, stop is generation-keyed.
 */
function toolCallsReducer(state: ToolCallsState, e: ToolEvent): ToolCallsState {
  if (e.type === 'reset') return emptyState;
  const drop = {...state, dropped: state.dropped + 1};
  if (e.type === 'turn') return {...state, gen: e.gen ?? state.gen + 1, stopped: false};
  if (e.type === 'stop') {
    // A stop for an older turn is a late echo; a second stop for this turn changes nothing.
    if (e.gen < state.gen || (e.gen === state.gen && state.stopped)) return drop;
    const at = timeOf(e.at);
    return {...state, gen: e.gen, stopped: true, calls: state.calls.map(c => isTerminal(c.status) ? c : {...c, status: 'cancelled', endedAt: at})};
  }
  const gen = e.gen ?? state.gen;
  if (gen < state.gen || (gen === state.gen && state.stopped)) return drop;
  // A newer generation opens its turn.
  if (gen > state.gen) state = {...state, gen, stopped: false};
  const i = state.calls.findIndex(c => c.id === e.id);

  if (i === -1) {
    // A result, ask or reply with no call yet: keep it as an orphan, never drop it.
    const orphan = e.type === 'result' || e.type === 'ask' || e.type === 'reply' || e.type === 'progress';
    const seed: ToolCallData = {id: e.id, tool: ('tool' in e && e.tool) || 'unknown', status: 'pending', seq: e.seq, orphan, receivedAt: timeOf(e.at)};
    return {...state, calls: [...state.calls, {...transition(seed, e), seq: e.seq}]};
  }

  const call = state.calls[i];
  const replace = (next: ToolCallData) => ({...state, calls: state.calls.map((c, j) => (j === i ? next : c))});

  // A late call or start for an orphan fills in what the orphan lacked, without reopening it.
  if (call.orphan && (e.type === 'call' || e.type === 'start')) {
    const filled = {...call, tool: call.tool === 'unknown' ? (e.tool ?? call.tool) : call.tool, input: call.input ?? e.input, orphan: false};
    return replace(isTerminal(call.status) || e.seq <= call.seq ? filled : {...transition(filled, e), seq: e.seq});
  }
  if (e.seq <= call.seq) return drop;
  if (isTerminal(call.status)) return drop;
  return replace({...transition(call, e), seq: e.seq});
}

/** The lifecycle as a hook: `[state, dispatch]`. */
function useToolCalls(initial: ToolCallData[] = []) {
  return useReducer(toolCallsReducer, {...emptyState, calls: initial});
}

// ---------- Registry ----------

type BodyContext = {size: 'default' | 'sm'; labels?: ToolCallLabels};

type ToolRenderer = {
  /** Labels: the -ing phrase, the done phrase and the imperative used when asking or denied. */
  active: string;
  done: string;
  ask: string;
  /** The noun in "Preparing <noun>" while arguments stream. */
  noun: string;
  /** The card's question: "Run this command?", or a function of the input. Defaults to "<ask> this <noun>?". */
  confirm?: string | ((input: Record<string, unknown>, call: ToolCallData) => string);
  /** The detail after the label: a path, a command, a query. */
  detail?: (input: Record<string, unknown>, call: ToolCallData) => string | undefined;
  /** The detail as the row draws it, when it marks part of itself (a failed count in the failure colour). */
  detailNode?: (input: Record<string, unknown>, call: ToolCallData) => React.ReactNode | undefined;
  /** The detail is a string a person copies or matches (a path, a command, a URL), set in mono. False for prose. */
  detailMono?: boolean;
  /** The rich body. Null keeps the row one line. */
  body?: (call: ToolCallData, ctx: BodyContext) => React.ReactNode | null;
  /** Output cap in lines before "Show more". */
  lines: number;
  /** Summary words for a finished turn, keyed so grep and glob count together. */
  summary: {key: string; one: string; many: (n: number) => string};
};

const registry = new Map<string, ToolRenderer>();
const aliases = new Map<string, string>();

/** Adds or replaces a renderer, with alias names that resolve to it. */
function registerTool(name: string, renderer: ToolRenderer, alias: string[] = []) {
  registry.set(name, renderer);
  for (const a of alias) aliases.set(a, name);
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const firstOf = (input: Record<string, unknown>, keys: string[]) => keys.map(k => str(input[k])).find(Boolean);
const useful = ['filePath', 'path', 'file', 'url', 'query', 'pattern', 'command', 'description', 'name', 'id'];
const basename = (p?: string) => p?.split('/').filter(Boolean).at(-1) ?? p;

/** The generic renderer for an unknown tool: its name, the first useful argument, up to 3 scalars. */
function genericRenderer(name: string): ToolRenderer {
  return {
    active: `Calling ${name}`, done: `Called ${name}`, ask: `Call ${name}`, noun: name, confirm: `Allow ${name}?`, lines: 8, detailMono: false,
    summary: {key: `tool:${name}`, one: `called ${name}`, many: n => `called ${name} ${n} times`},
    detail: input => firstOf(input, useful),
    body: (call, ctx) => {
      // What the row's detail already says is not repeated.
      const said = firstOf(call.input ?? {}, useful);
      const scalars = Object.entries(call.input ?? {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v) && String(v) !== said).slice(0, 3);
      const out = call.output ?? str(call.metadata?.output);
      if (!scalars.length && !out) return null;
      return <div className="flex min-w-0 flex-col gap-2">
        {scalars.length > 0 && <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 type-code-sm">
          {scalars.map(([k, v]) => <div key={k} className="contents"><dt className="text-text-2">{k}</dt><dd className="truncate text-text-1">{String(v)}</dd></div>)}
        </dl>}
        {out && <CappedOutput text={out} lines={8} labels={ctx.labels}/>}
      </div>;
    },
  };
}

/** The renderer for a tool name, through aliases, falling back to the generic one. */
function resolveTool(name: string): ToolRenderer {
  const key = aliases.get(name) ?? name;
  return registry.get(key) ?? genericRenderer(name);
}

// ANSI escapes (colours, cursor moves) never reach the screen. A lone \r is a carriage return: the text after it
// overwrites the line from its start, so a progress bar reads as its last frame.
// eslint-disable-next-line no-control-regex
const ansi = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const cleanOutput = (text: string) => text.replace(ansi, '').replace(/\r\n/g, '\n').split('\n')
  .map(line => line.split('\r').reduce((shown, part) => part + shown.slice(part.length), ''))
  .join('\n');

const contextRenderer = (active: string, done: string, ask: string, noun: string, key: string, one: string, many: (n: number) => string, keys: string[]): ToolRenderer => ({
  active, done, ask, noun, confirm: `Allow ${noun}?`, lines: 8, detailMono: true,
  summary: {key, one, many},
  detail: input => {
    const v = firstOf(input, keys);
    return keys[0] === 'filePath' ? basename(v) : v;
  },
  body: (call, ctx) => {
    const out = call.output ?? str(call.metadata?.output);
    return out ? <CappedOutput text={out} lines={8} labels={ctx.labels}/> : null;
  },
});

registerTool('read', contextRenderer('Reading', 'Read', 'Read', 'read', 'read', 'read a file', n => `read ${n} files`, ['filePath', 'path', 'file']));
registerTool('glob', contextRenderer('Finding files', 'Found files', 'Find files', 'search', 'search', 'searched once', n => `searched ${n} times`, ['pattern']));
registerTool('grep', contextRenderer('Searching', 'Searched', 'Search', 'search', 'search', 'searched once', n => `searched ${n} times`, ['pattern', 'query']));
registerTool('list', contextRenderer('Listing', 'Listed', 'List', 'list', 'list', 'listed a folder', n => `listed ${n} folders`, ['path']), ['ls']);

/** A command as a shell shows it: a quiet $ that copy and selection skip, then the command. */
function Command({children}: {children: React.ReactNode}) {
  return <code><span aria-hidden className="text-text-3 select-none">$ </span>{children}</code>;
}

registerTool('shell', {
  active: 'Running', done: 'Ran', ask: 'Run', noun: 'command', confirm: 'Run this command?', lines: 24, detailMono: true,
  summary: {key: 'shell', one: 'ran a command', many: n => `ran ${n} commands`},
  // The command, not the description: descriptions are imperative ("Run the tests") and read badly after "Ran".
  detail: input => str(input.command) ?? str(input.description),
  body: (call, ctx) => {
    const command = str(call.input?.command);
    const out = call.output ?? str(call.metadata?.output);
    // The row already says the command, so with no output yet there is nothing to open. A command the row cannot show
    // whole (several lines, or longer than a line) is kept in the body with the output.
    if (!out) return null;
    const whole = !!command && (command.includes('\n') || command.length > 80);
    return <div className="flex min-w-0 flex-col gap-1">
      {whole && <pre dir="ltr" className="overflow-x-auto text-start type-code-sm text-text-1"><Command>{command}</Command></pre>}
      <CappedOutput text={cleanOutput(out)} lines={24} labels={ctx.labels}/>
    </div>;
  },
}, ['bash', 'sh', 'zsh', 'run_command', 'terminal']);

registerTool('edit', {
  active: 'Editing', done: 'Edited', ask: 'Edit', noun: 'edit', confirm: 'Apply this edit?', lines: 8, detailMono: true,
  summary: {key: 'edit', one: 'edited a file', many: n => `edited ${n} files`},
  detail: input => basename(firstOf(input, ['filePath', 'path', 'file'])),
  body: (call, ctx) => {
    const patch = str(call.metadata?.diff) ?? str(call.metadata?.patch);
    if (!patch) return null;
    return <PatchPreview patch={patch} lines={8} labels={ctx.labels}/>;
  },
}, ['write', 'apply_patch', 'patch', 'multiedit', 'str_replace']);

registerTool('webfetch', {
  active: 'Fetching', done: 'Fetched', ask: 'Fetch', noun: 'fetch', confirm: 'Fetch this page?', lines: 8, detailMono: true,
  summary: {key: 'web', one: 'fetched a page', many: n => `fetched ${n} pages`},
  detail: input => {
    const url = str(input.url);
    try { return url ? new URL(url).host + new URL(url).pathname.replace(/\/$/, '') : undefined; } catch { return url; }
  },
  body: (call, ctx) => (call.output ? <CappedOutput text={call.output} lines={8} labels={ctx.labels}/> : null),
}, ['fetch', 'web_fetch']);

/** The requests an http or mcp call reports in metadata.requests, newest last. */
const requestsOf = (call: ToolCallData) => (Array.isArray(call.metadata?.requests) ? call.metadata.requests as TickerRequest[] : []);

registerTool('http', {
  active: 'Calling', done: 'Called', ask: 'Call', noun: 'request', confirm: 'Send this request?', lines: 10, detailMono: false,
  summary: {key: 'http', one: 'made a request', many: n => `made ${n} requests`},
  // While it runs, the newest target; once done, "42 requests, 2 failed".
  detail: (input, call) => {
    const requests = requestsOf(call);
    if (requests.length && isTerminal(call.status)) return summarizeRequests(requests);
    return requests.at(-1)?.target ?? str(input.url) ?? str(input.server) ?? str(input.name);
  },
  detailNode: (_, call) => {
    const requests = requestsOf(call);
    return requests.length && isTerminal(call.status) ? <RequestSummary items={requests}/> : undefined;
  },
  body: call => {
    const requests = requestsOf(call);
    return requests.length ? <RequestTicker items={requests} live={call.status === 'running'}/> : null;
  },
}, ['http_request', 'api', 'mcp', 'mcp_call']);

registerTool('websearch', {
  active: 'Searching the web for', done: 'Searched the web for', ask: 'Search the web for', noun: 'search', confirm: 'Search the web?', lines: 8,
  summary: {key: 'websearch', one: 'searched the web', many: n => `searched the web ${n} times`},
  detail: input => str(input.query),
  body: (call, ctx) => (call.output ? <CappedOutput text={call.output} lines={8} labels={ctx.labels}/> : null),
}, ['web_search', 'search_web']);

registerTool('task', {
  active: 'Delegating', done: 'Delegated', ask: 'Delegate', noun: 'task', confirm: 'Delegate this task?', lines: 8,
  summary: {key: 'task', one: 'ran a subagent', many: n => `ran ${n} subagents`},
  detail: (input, call) => {
    const current = str(call.metadata?.current);
    return call.status === 'running' && current ? `↳ ${current}` : str(input.description);
  },
  body: (call, ctx) => (call.output ? <CappedOutput text={call.output} lines={8} labels={ctx.labels}/> : null),
}, ['subagent', 'agent']);

// ---------- Words ----------

type ToolCallLabels = {
  /** The status words: Failed, Denied and Stopped are shown; the rest are read aloud. */
  status?: Partial<Record<ToolStatus, string>>;
  /** A result whose call never came. */
  orphaned?: string;
  /** The label and detail of an orphan that never named its tool. */
  result?: string;
  forCall?: (id: string) => string;
  /** The cap's button and note. */
  showMore?: (count: number, unit: 'lines' | 'characters') => string;
  showLess?: string;
  trimmed?: (characters: number) => string;
  /** Read after a patch's counts. */
  added?: string;
  removed?: string;
  /** A finished turn's line: "Worked for 14s", and "Ran 5 tools" when the calls have no times. */
  worked?: (time: string) => string;
  ranTools?: (count: number) => string;
  /** The coral word at the end of a folded line that holds failures. */
  failedCount?: (count: number) => string;
  /** The card's two buttons. */
  allow?: string;
  deny?: string;
};

const toolLabels: Required<ToolCallLabels> = {
  status: {pending: 'Preparing', running: 'Running', completed: 'Done', error: statusLabels.fail, 'awaiting-permission': statusLabels.waiting, denied: 'Denied', cancelled: 'Stopped'},
  orphaned: 'Orphaned result',
  result: 'Result',
  forCall: id => `for call ${id}`,
  showMore: (count, unit) => `Show ${formatCount(count)} more ${unit === 'lines' ? (count === 1 ? 'line' : 'lines') : 'characters'}`,
  showLess: 'Show less',
  trimmed: characters => `Trimmed at ${formatCount(characters)} characters`,
  added: 'added',
  removed: 'removed',
  worked: time => `Worked for ${time}`,
  ranTools: count => (count === 1 ? 'Ran 1 tool' : `Ran ${count} tools`),
  failedCount: count => (count === 1 ? 'Failed' : `${count} failed`),
  allow: 'Allow',
  deny: 'Deny',
};

/** The default words with a caller's on top; status words merge one by one. */
const wordsFor = (labels?: ToolCallLabels) => ({...toolLabels, ...labels, status: {...toolLabels.status, ...labels?.status} as Record<ToolStatus, string>});

// ---------- Output ----------

/**
 * Output cut at `lines` and at `lines` x 120 characters while collapsed, and at `chars` in all, with the cut said in
 * words and a button for the rest. One 250,000-character line opens as 1,200 characters, not as a wall. Shown in full,
 * it scrolls inside a box 384px tall.
 */
function CappedOutput({text, lines, chars = 20_000, labels}: {text: string; lines: number; chars?: number; labels?: ToolCallLabels}) {
  const words = wordsFor(labels);
  const [all, setAll] = useState(false);
  const trimmed = text.length > chars;
  const body = (trimmed ? text.slice(0, chars) : text).replace(/\n+$/, '');
  const rows = body.split('\n');
  const hiddenLines = Math.max(0, rows.length - lines);
  const byLines = hiddenLines ? rows.slice(0, lines).join('\n') : body;
  const limit = lines * CHARS_PER_LINE;
  const hiddenChars = Math.max(0, byLines.length - limit);
  const shown = all ? body : hiddenChars ? `${byLines.slice(0, limit)}…` : byLines;
  const more = hiddenLines > 0 || hiddenChars > 0;
  return <div data-slot="tool-call-output" className="flex min-w-0 flex-col gap-1">
    <pre dir="ltr" data-all={all || undefined} className="min-w-0 overflow-x-auto text-start type-code-sm whitespace-pre-wrap text-text-2 [overflow-wrap:anywhere] data-all:max-h-96 data-all:overflow-y-auto"><code>{shown}</code></pre>
    {trimmed && <p className="type-caption text-text-2 data">{words.trimmed(chars)}</p>}
    {more && <ShowMoreRow data-slot="tool-call-more" onClick={() => setAll(v => !v)}>{all ? words.showLess : hiddenLines > 0 ? words.showMore(hiddenLines, 'lines') : words.showMore(hiddenChars, 'characters')}</ShowMoreRow>}
  </div>;
}

/** "+12 −3": the lines a patch added and removed, with the words a screen reader hears instead of the signs. */
function DiffCount({added, removed, addedLabel = 'added', removedLabel = 'removed', className}: {added: number; removed: number; addedLabel?: string; removedLabel?: string; className?: string}) {
  return <span data-slot="diff-count" dir="ltr" className={cn('data', className)}><span aria-hidden>+</span>{added}<span className="sr-only"> {addedLabel}</span> <span aria-hidden>−</span>{removed}<span className="sr-only"> {removedLabel}</span></span>;
}

/** The first lines of a unified patch, signed, with counts. */
function PatchPreview({patch, lines, labels}: {patch: string; lines: number; labels?: ToolCallLabels}) {
  const words = wordsFor(labels);
  const changed = patch.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  const added = changed.filter(l => l.startsWith('+')).length;
  const removed = changed.length - added;
  return <div className="flex min-w-0 flex-col gap-1">
    <p className="text-start type-caption text-text-2"><DiffCount added={added} removed={removed} addedLabel={words.added} removedLabel={words.removed}/></p>
    <CappedOutput text={changed.map(l => (l[0] === '-' ? '−' : '+') + ' ' + l.slice(1)).join('\n')} lines={lines} labels={labels}/>
  </div>;
}

// ---------- Labels and timing ----------

/** The row's label and detail for a call in its current state. `labels` names an orphan that never named its tool. */
function toolLabel(call: ToolCallData, labels?: Pick<ToolCallLabels, 'result' | 'forCall'>) {
  const r = resolveTool(call.tool);
  const detail = (call.input && r.detail?.(call.input, call)) ?? call.title;
  // An orphan whose call never named its tool: say what it is, a result, and whose.
  if (call.orphan && call.tool === 'unknown') return {text: labels?.result ?? toolLabels.result, detail: call.title ?? (labels?.forCall ?? toolLabels.forCall)(call.id)};
  switch (call.status) {
    case 'pending': return {text: `Preparing ${r.noun}`, detail: call.input ? detail : undefined};
    case 'running': return {text: r.active, detail};
    case 'completed': return {text: r.done, detail};
    // Failed and stopped calls take the imperative too: "Fetch docs" beside "Failed", never "Fetching".
    default: return {text: r.ask, detail};
  }
}

/** How long a call took, as a clock reads (420ms, 1.2s, 2m 04s). */
const formatDuration = formatElapsed;

/**
 * Moves focus to the row when Allow and Deny are replaced by it. Without it the pressed button leaves the page and
 * focus falls to the body, so a keyboard or screen reader user starts again from the top.
 */
function useFocusWhenReplaced<Target extends HTMLElement, Region extends HTMLElement>(replaced: boolean) {
  const region = useRef<Region>(null);
  const target = useRef<Target>(null);
  const was = useRef(replaced);
  useEffect(() => {
    const before = was.current;
    was.current = replaced;
    if (before || !replaced) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected || region.current?.contains(active)) target.current?.focus();
  }, [replaced]);
  return {region, target};
}

// ---------- The row ----------

type ToolCallProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  call: ToolCallData;
  /** default is a 32px line; sm is 28px, for a dense list. */
  size?: 'default' | 'sm';
  /** Called with the person's answer to an awaiting-permission call. It shows Deny and Allow; dispatch a reply with it. */
  onReply?: (reply: ToolReply) => void;
  /** Your own buttons for an awaiting-permission call, on the card's footer row, in place of Deny and Allow. onReply wins. */
  actions?: React.ReactNode;
  /** Overrides the registry's -ing phrase: "Deploying web". */
  label?: string;
  /** Overrides the done phrase. Defaults to the past tense of `label` when label is set. */
  doneLabel?: string;
  /** Overrides the detail after the label. */
  detail?: string;
  /** Sets the detail in mono (a path, a command) or in sans (prose). Defaults to the renderer's detailMono. */
  detailMono?: boolean;
  /** Ms the call took, when the data has no timestamps. */
  duration?: number;
  /** A custom body. Upgrades the row to a disclosure like a registry body does. */
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The status words and the body's words, for another language. The tool's verbs come from registerTool. */
  labels?: ToolCallLabels;
};

function ToolCall({call, size = 'default', onReply, actions, label, doneLabel, detail: detailProp, detailMono, duration, children, open, defaultOpen, onOpenChange, labels, className, ref, ...allProps}: ToolCallProps) {
  const words = wordsFor(labels);
  const {force, rest: props} = splitForce(allProps);
  const r = resolveTool(call.tool);
  const running = call.status === 'running';
  const pending = call.status === 'pending';
  const asking = call.status === 'awaiting-permission';
  const denied = call.status === 'denied';
  const failed = call.status === 'error';
  const ms = running || pending ? undefined : duration ?? (call.startedAt !== undefined && call.endedAt !== undefined ? Math.max(0, call.endedAt - call.startedAt) : undefined);
  const base = toolLabel(call, words);
  const text = label === undefined ? base.text : call.status === 'completed' ? (doneLabel ?? pastTense(label)) : label;
  const detail = detailProp ?? base.detail;
  // A renderer may draw its own detail, but never over a caller's, an orphan's or a call still without input.
  const detailShown = detailProp ?? (!call.orphan && call.input ? r.detailNode?.(call.input, call) : undefined) ?? detail;
  const mono = detailMono ?? (call.orphan && call.tool === 'unknown' ? false : !!r.detailMono);
  const orphaned = !!call.orphan && isTerminal(call.status);
  const word = orphaned ? words.orphaned : words.status[call.status];
  // Allow and Deny leave with the waiting state, taking focus with them. The row takes it instead.
  const {region, target} = useFocusWhenReplaced<HTMLElement, HTMLDivElement>(!asking);
  const rootRef = useMemo(() => mergeRefs(region, ref), [region, ref]);
  const rowRef = useCallback((el: HTMLElement | null) => { target.current = el; }, [target]);
  const titleId = useId();

  // A failed call opens on its message, the moment it fails, so trouble is never one click away.
  const [openState, setOpenState] = useState(defaultOpen ?? failed);
  useEffect(() => { if (failed) setOpenState(true); }, [failed]);

  const shared = {
    'data-slot': 'tool-call',
    'data-status': call.status,
    'data-tool': call.tool,
    'data-size': size,
    'data-orphan': call.orphan || undefined,
    // The thread's jump goes to the call waiting on the person.
    'data-waiting': asking || undefined,
    'aria-busy': running || pending || undefined,
  };
  const rootClass = cn('group/tool-call relative flex w-full min-w-0 flex-col text-text-1', className);

  // Waiting: the row is a card of its own, a decision. The question is the title in the panel, one sentence and the
  // detail in full under it, Deny and Allow on the shell's footer row.
  if (asking) {
    const command = str(call.input?.command);
    const patterns = call.permission?.patterns.join('\n');
    const full = command ?? patterns ?? (call.input && firstOf(call.input, useful)) ?? detail;
    const question = typeof r.confirm === 'function' ? r.confirm(call.input ?? {}, call) : r.confirm ?? `${r.ask} this ${r.noun}?`;
    const footer = onReply
      ? <CardFooter data-slot="tool-call-actions">
          <Button size="sm" variant="secondary" onClick={() => onReply('reject')}>{words.deny}</Button>
          <Button size="sm" variant="confirm" onClick={() => onReply('once')}>{words.allow}</Button>
        </CardFooter>
      : actions ? <CardFooter data-slot="tool-call-actions">{actions}</CardFooter> : null;
    return <div {...shared} {...props} ref={rootRef} className={cn(rootClass, 'my-1')}>
      <Card data-slot="tool-call-approval" role="group" aria-labelledby={titleId}>
        <CardHeader><CardTitle id={titleId} data-slot="tool-call-title">{question}</CardTitle></CardHeader>
        <CardContent className="gap-2">
          {call.permission?.message && <p data-slot="tool-call-request" className="type-body-sm text-text-2">{call.permission.message}</p>}
          {full && (command
            ? <pre dir="ltr" data-slot="tool-call-command" className="well min-w-0 rounded-overlay px-3 py-2 text-start type-code-sm whitespace-pre-wrap text-text-1 [overflow-wrap:anywhere]"><Command>{full}</Command></pre>
            : <p data-slot="tool-call-command" className="well min-w-0 rounded-overlay px-3 py-2 type-body-sm whitespace-pre-wrap text-text-1 [overflow-wrap:anywhere]">{full}</p>)}
        </CardContent>
        {footer}
      </Card>
    </div>;
  }

  const rendered = children ?? r.body?.(call, {size, labels}) ?? null;
  const note = failed && call.error ? <p data-slot="tool-call-error" className="type-body-sm text-text-1 [overflow-wrap:anywhere]">{call.error}</p>
    : denied && call.reason ? <p data-slot="tool-call-reason" className="type-body-sm text-text-2 [overflow-wrap:anywhere]">{call.reason}</p>
      : null;
  const expands = rendered !== null || note !== null;

  // The glyph cell holds the state; the end of the line holds the duration, and trouble and a stop say so in a word.
  const glyph: StepState = orphaned || call.status === 'cancelled' || denied ? 'stopped' : running || pending ? 'running' : failed ? 'fail' : 'done';
  const end = orphaned ? <span>{word}</span>
    : running || pending ? <span className="sr-only">{word}</span>
      : failed ? <><span className="text-fail-text">{word}</span>{ms !== undefined && formatDuration(ms)}</>
        : call.status === 'cancelled' ? <span>{word}</span>
          : denied ? null
            : <><span className="sr-only">{word}</span>{ms !== undefined && formatDuration(ms)}</>;

  const row = <>
    <StepGlyph state={glyph}/>
    <span data-slot="tool-call-label" className="shrink-0 text-text-2">{denied ? word : text}</span>
    {/* The target truncates first, down to 48px. On a phone it wraps to a second line instead, so the meaning stays. */}
    <span
      data-slot="tool-call-detail"
      dir={mono ? 'ltr' : undefined}
      title={typeof detail === 'string' ? detail : undefined}
      className={cn('min-w-12 truncate text-start text-text-1 max-sm:overflow-visible max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]', mono && 'mono', !detail && 'min-w-0')}
    >{detailShown}</span>
    <span data-slot="tool-call-end" className="flex shrink-0 items-center gap-2 whitespace-nowrap text-text-2 data empty:hidden">{end}</span>
    <Disclosure open={expands} end/>
  </>;

  if (!expands) {
    return <div {...shared} {...props} ref={rootRef} className={rootClass}>
      {/* tabIndex -1: out of the tab order, but it can take focus when Allow and Deny go. */}
      <div ref={rowRef} tabIndex={-1} data-slot="tool-call-row" className={rowVariants({size, opens: false})} {...force}>
        {row}
      </div>
    </div>;
  }

  return <CollapsiblePrimitive.Root
    {...shared}
    open={open ?? openState}
    onOpenChange={next => { setOpenState(next); onOpenChange?.(next); }}
    {...props}
    ref={rootRef}
    className={rootClass}
  >
    <CollapsiblePrimitive.Trigger ref={rowRef} data-slot="tool-call-row" {...force} className={rowVariants({size})}>
      {row}
    </CollapsiblePrimitive.Trigger>
    {/* The panel cuts: no height tween. The body opens at its natural height, under the verb. */}
    <CollapsiblePrimitive.Panel data-slot="tool-call-content" className="flex min-w-0 flex-col gap-2 ps-6 pt-0.5 pb-2">
      {note}
      {rendered !== null && <div data-slot="tool-call-well" className="flex min-w-0 flex-col gap-3 well rounded-overlay px-3 py-2">{rendered}</div>}
    </CollapsiblePrimitive.Panel>
  </CollapsiblePrimitive.Root>;
}

// ---------- Rows of a turn ----------

type ToolItem =
  | {type: 'call'; key: string; call: ToolCallData}
  | {type: 'group'; key: string; calls: ToolCallData[]; done: boolean};

/**
 * What a turn's list shows. Done, two or more calls fold into one line, keyed `group:done`. Live, the completed calls
 * before the first one that is not completed fold into `group:earlier` when there are two or more, and the rest stay
 * rows. The newest call is never inside a live group, even once it has completed, so the turn always shows its last
 * step. One call is always its own row.
 */
function groupToolCalls(calls: readonly ToolCallData[], live = false): ToolItem[] {
  const rows = (list: readonly ToolCallData[]): ToolItem[] => list.map(call => ({type: 'call', key: call.id, call}));
  if (!live) return calls.length > 1 ? [{type: 'group', key: 'group:done', calls: [...calls], done: true}] : rows(calls);
  const lead = calls.findIndex(c => c.status !== 'completed');
  const n = Math.min(lead === -1 ? calls.length : lead, calls.length - 1);
  return n > 1 ? [{type: 'group', key: 'group:earlier', calls: calls.slice(0, n), done: false}, ...rows(calls.slice(n))] : rows(calls);
}

/** Ms from the first start to the last end, or undefined when the calls carry no times. */
function spanOf(calls: readonly ToolCallData[]) {
  const starts = calls.flatMap(c => c.startedAt ?? []);
  const ends = calls.flatMap(c => c.endedAt ?? []);
  return starts.length && ends.length ? Math.max(0, Math.max(...ends) - Math.min(...starts)) : undefined;
}

/**
 * Calls folded into one line that opens them inline. A finished turn reads "Worked for 14s" (or "Ran 5 tools" with no
 * times) and a failure keeps its coral word at the end; the calls before a live one read as what they did.
 */
function ToolCallGroup({calls, done = false, size = 'default', labels, ...props}: Omit<React.ComponentProps<typeof ActivityGroup>, 'summary' | 'meta' | 'live' | 'children'> & {calls: readonly ToolCallData[]; done?: boolean; size?: 'default' | 'sm'; labels?: ToolCallLabels}) {
  const words = wordsFor(labels);
  const span = spanOf(calls);
  const failures = calls.filter(c => c.status === 'error').length;
  const took = calls.reduce((sum, c) => sum + (c.startedAt !== undefined && c.endedAt !== undefined ? Math.max(0, c.endedAt - c.startedAt) : 0), 0);
  const summary = done ? (span ? words.worked(formatDuration(span)) : words.ranTools(calls.length)) : summarizeToolCalls(calls);
  const meta = failures ? <span className="text-fail-text">{words.failedCount(failures)}</span> : !done && took > 0 ? formatDuration(took) : null;
  return <ActivityGroup summary={summary} meta={meta} size={size} {...props}>
    {calls.map(c => <ToolCall key={c.id} call={c} size={size} labels={labels}/>)}
  </ActivityGroup>;
}

/** Hides orphans younger than `ttl` ms, so a result that is only slightly early waits for its call. */
function useOrphanGate(calls: readonly ToolCallData[], ttl: number) {
  const [, force] = useState(0);
  const young = calls.filter(c => c.orphan && c.receivedAt !== undefined && Date.now() - c.receivedAt < ttl);
  useEffect(() => {
    if (!young.length) return;
    const next = Math.min(...young.map(c => ttl - (Date.now() - c.receivedAt!)));
    const t = setTimeout(() => force(n => n + 1), Math.max(0, next) + 10);
    return () => clearTimeout(t);
  });
  return calls.filter(c => !young.includes(c));
}

type ToolCallListProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  calls: readonly ToolCallData[];
  /** The turn is still working. Defaults to any call that has not ended; it sets whether the list folds. */
  live?: boolean;
  /** Hide completed calls. Running, waiting and failed calls always show. */
  hideCompleted?: boolean;
  /** Ms a result that arrived before its call waits for it before it shows as an orphan. */
  orphanTtl?: number;
  size?: 'default' | 'sm';
  /** The person's answer to the call waiting on them: it shows that call's Deny and Allow. */
  onReply?: (call: ToolCallData, reply: ToolReply) => void;
  /** Your own buttons for the waiting call, by call, in place of Deny and Allow. onReply wins when both are set. */
  actions?: (call: ToolCallData) => React.ReactNode;
  /** Passed to every row and group, for another language. */
  labels?: ToolCallLabels;
};

/**
 * The calls of a turn as quiet lines, no frame around them. Live, the completed calls before the current one fold into
 * one line and the current call is its own row with the arc; done, everything folds into "Worked for 14s".
 */
function ToolCallList({calls, live, hideCompleted = false, orphanTtl = 2000, size = 'default', onReply, actions, labels, className, ...props}: ToolCallListProps) {
  const ready = useOrphanGate(calls, orphanTtl);
  const visible = hideCompleted ? ready.filter(c => c.status !== 'completed') : ready;
  const active = live ?? visible.some(c => !isTerminal(c.status));
  const items = groupToolCalls(visible, active);
  return <div data-slot="tool-call-list" className={cn('flex min-w-0 flex-col', className)} {...props}>
    {items.map(item => item.type === 'group'
      ? <ToolCallGroup key={item.key} calls={item.calls} done={item.done} size={size} labels={labels}/>
      : <ToolCall key={item.key} call={item.call} size={size} labels={labels} onReply={onReply && (reply => onReply(item.call, reply))} actions={actions?.(item.call)}/>)}
  </div>;
}

// ---------- Summary for Activity ----------

const endOf = (s: ToolStatus) => (s === 'completed' ? 'ok' : s === 'error' ? 'fail' : s === 'cancelled' ? 'stopped' : s === 'denied' ? 'denied' : s === 'awaiting-permission' ? 'waiting' : s) as 'pending' | 'running' | 'ok' | 'fail' | 'stopped' | 'denied' | 'waiting';

/** "Edited 3 files, ran a command, 1 failed, 1 stopped". Only populated counts show. */
function summarizeToolCalls(calls: readonly ToolCallData[]) {
  const done = new Map<string, {n: number; r: ToolRenderer}>();
  let failed = 0, stopped = 0, denied = 0;
  for (const c of calls) {
    if (c.status === 'completed') {
      const r = resolveTool(c.tool);
      const hit = done.get(r.summary.key);
      done.set(r.summary.key, {n: (hit?.n ?? 0) + 1, r});
    } else if (c.status === 'error') failed++;
    else if (c.status === 'cancelled') stopped++;
    else if (c.status === 'denied') denied++;
  }
  return joinSummary(
    [...done.values()].map(({n, r}) => (n === 1 ? r.summary.one : r.summary.many(n))),
    [failed && `${failed} failed`, denied && `${denied} denied`, stopped && `${stopped} stopped`].filter(Boolean) as string[],
  );
}

/** Props for an <Activity> over a list of calls: the call it follows, and the summary when done. */
function toolActivity(calls: readonly ToolCallData[], labels: {waiting?: string} = {}): {label: string; active: boolean; doneLabel: string; status: ActivityEnd} {
  const items = calls.map(c => ({c, status: endOf(c.status)}));
  const head = pickActivity(items)?.c;
  const active = calls.some(c => c.status === 'pending' || c.status === 'running' || c.status === 'awaiting-permission');
  // The header follows the live (-ing) phrase of its head, whatever state the head is in; the done label is its past
  // tense. A stopped head never shows the imperative "Run" while the header settles.
  const live = head && toolLabel({...head, status: 'running'});
  const label = head ? (head.status === 'awaiting-permission' ? (labels.waiting ?? statusLabels.waiting) : [live!.text, live!.detail].filter(Boolean).join(' ')) : '';
  // A turn that was stopped ends on the stopped word even when some calls finished first.
  const status: ActivityEnd = calls.some(c => c.status === 'error') ? 'fail' : calls.some(c => c.status === 'cancelled') ? 'stopped' : 'ok';
  return {label, active, doneLabel: summarizeToolCalls(calls) || pastTense(label), status};
}

export {
  ToolCall, ToolCallGroup, ToolCallList, CappedOutput, DiffCount,
  toolCallsReducer, useToolCalls, groupToolCalls, registerTool, resolveTool, summarizeToolCalls, toolActivity, toolLabel,
  formatDuration, cleanOutput, isTerminal,
  type ToolCallProps, type ToolCallLabels, type ToolReply, type ToolCallData, type ToolStatus, type ToolEvent, type ToolCallsState, type ToolRenderer, type ToolItem, type ToolCallListProps,
};
