"use client";

import { IsoFigure } from "@/components/iso";
import { approveFigure } from "./approve";
import { checkFigure } from "./check";
import { payFigure } from "./pay";
import { recordFigure } from "./record";

// Figure modules carry functions, so server components pick them by name here on the client.
const FIGURES = { record: recordFigure, check: checkFigure, approve: approveFigure, pay: payFigure } as const;

export type LandingFigureName = keyof typeof FIGURES;

export function LandingFigure({ name, className }: { name: LandingFigureName; className?: string }) {
  return <IsoFigure figure={FIGURES[name]} className={className} />;
}
