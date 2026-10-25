'use client';

import * as React from 'react';
import {Icon, ArrowUp} from '@/components/glaze/icon';
import {Button, type ButtonProps} from '@/components/glaze/ui/button';
import {cn, mergeClass} from '@/lib/glaze/utils';

// The composer's one action: send while the prompt is ready, stop while the agent works, in the same box so the
// pointer never moves. It is the composer's primary, so it is ink glass: Button's primary icon button, 26px in the
// composer's footer row by default. The statuses are ready, submitted, streaming, stopping and error.
// - ready: ink glass with an up arrow. With nothing to send (`empty`) it is Button's disabled pill, flat grey; the same
//   look, still focusable with a reason, while something blocks the send (`blockedReason`, uploads).
// - submitted: the prompt is on its way and no byte has come back. It is already Stop.
// - streaming: Stop, a small square on the same glass.
// - stopping: Stop was pressed. The box stays, presses are ignored, aria-busy is set and the square dims.
// - error: the last send failed. The arrow returns on ink glass, named "Send again". It stays ink, not coral: coral glass
//   means an action that cannot be undone, and sending again can. The failure is said in words beside it (the
//   composer's status line), never by the key.
//
// The considered detail: Stop works before the first byte. Most chat UIs disable the button while a request is in
// flight, so a slow or stuck request cannot be cancelled. Here `submitted` is the stop square. Stop is idempotent: the
// first press calls onStop once per `generation` and every later press, double click or held Enter is dropped, so a
// late cancel never fires twice and never cancels the next turn. onStop receives that generation, so the caller can
// settle the run it names and ignore a stop echo that lands after a newer run began.
//
// blockedReason is only a description. Sighted people need the same reason in visible text next to the button;
// inside PromptInput the status line carries it.

type SendStatus = 'ready' | 'submitted' | 'streaming' | 'stopping' | 'error';

type SendButtonLabels = {
  send?: string;
  stop?: string;
  stopping?: string;
  /** After a failed send. */
  sendAgain?: string;
};

type SendButtonProps = Omit<ButtonProps, 'children' | 'pending' | 'pendingLabel' | 'variant'> & {
  status?: SendStatus;
  /** Called once per generation when the person stops, with the generation it stops. */
  onStop?: (generation: string | number | undefined) => void;
  /** Nothing to send yet. Ignored while working, so stop always works. */
  empty?: boolean;
  /** Something blocks the send: "Waiting for 2 uploads". Disabled but focusable, and the reason is its description. */
  blockedReason?: string;
  /** The run this button stops. A new generation re-arms Stop; the same one never stops twice. */
  generation?: string | number;
  /** The button's name in each state, for another language. */
  labels?: SendButtonLabels;
};

const sendLabels: Required<SendButtonLabels> = {send: 'Send', stop: 'Stop', stopping: 'Stopping', sendAgain: 'Send again'};
const working = (status: SendStatus) => status === 'submitted' || status === 'streaming' || status === 'stopping';

function SendButton({status = 'ready', onStop, empty, blockedReason, generation, labels, disabled, onClick, size = 'icon-sm', className, type, ...props}: SendButtonProps) {
  const words = {...sendLabels, ...labels};
  const names: Record<SendStatus, string> = {ready: words.send, submitted: words.stop, streaming: words.stop, stopping: words.stopping, error: words.sendAgain};
  const reasonId = React.useId();
  // The generation that was stopped. A press for the same generation is dropped.
  const stopped = React.useRef<string | number | undefined | null>(null);
  const [stopPressed, setStopPressed] = React.useState(false);
  React.useEffect(() => {
    if (!working(status)) { stopped.current = null; setStopPressed(false); }
  }, [status]);
  React.useEffect(() => { stopped.current = null; setStopPressed(false); }, [generation]);

  const isWorking = working(status);
  const shown: SendStatus = isWorking && stopPressed ? 'stopping' : status;
  const blocked = !isWorking && !!blockedReason;
  const nothing = !isWorking && !!empty && !blocked;
  const stop = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (shown === 'stopping' || stopped.current === (generation ?? 'current')) return;
    stopped.current = generation ?? 'current';
    setStopPressed(true);
    onStop?.(generation);
  };
  const icon = size === 'icon-lg' ? 16 : size === 'icon' ? 14 : 12;

  return <>
    <Button
      data-slot="send-button"
      data-state={shown}
      data-empty={nothing || undefined}
      variant="primary"
      type={isWorking ? 'button' : type ?? 'submit'}
      size={size}
      disabled={isWorking ? disabled : disabled || empty || blocked}
      focusableWhenDisabled={blocked || shown === 'stopping'}
      aria-busy={shown === 'stopping' || undefined}
      aria-label={names[shown]}
      aria-describedby={blocked ? reasonId : undefined}
      aria-keyshortcuts={isWorking ? 'Escape' : 'Enter'}
      onClick={isWorking ? stop : onClick}
      className={mergeClass(shown === 'stopping' && 'cursor-progress', className)}
      {...props}
    >
      {isWorking
        ? <span aria-hidden data-slot="send-button-stop" className={cn('size-2 rounded-[1.5px] bg-current forced-colors:bg-[CanvasText]', shown === 'stopping' && 'opacity-40')}/>/* value-ok: the stop square's corner is part of the glyph's drawing, not a container radius */
        : <Icon icon={ArrowUp} size={icon}/>}
    </Button>
    {blocked && <span id={reasonId} hidden>{blockedReason}</span>}
  </>;
}

export {SendButton, type SendButtonProps, type SendButtonLabels, type SendStatus};
