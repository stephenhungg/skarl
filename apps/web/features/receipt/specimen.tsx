"use client";

import { useEffect, useRef, useState } from "react";
import { Fingerprint } from "@/features/receipt/visuals/fingerprint";
import { ReceiptQr } from "@/features/receipt/visuals/qr";
import s from "./receipt.module.css";

type Seed = { hash: string; media: string; hue: number; duration: number };

/** Right side of the hero: fingerprint stage, appearance toggle, scan button and the about note. */
export function Specimen({ id, seed }: { id: string; seed: Seed }) {
  const [filament, setFilament] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const codeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setUrl(`${window.location.origin}/asset/${id}`);
  }, [id]);

  return (
    <div className={s.specimen}>
      <div className={s.specimenTop}>
        <span>Fingerprint</span>
        <div className={s.appearanceControls} role="group" aria-label="Fingerprint appearance">
          <button type="button" disabled={scanning} aria-pressed={!filament} onClick={() => setFilament(false)}>
            Pearl
          </button>
          <button type="button" disabled={scanning} aria-pressed={filament} onClick={() => setFilament(true)}>
            Filament
          </button>
        </div>
      </div>
      <div className={s.fingerprintStage} data-scanning={scanning}>
        <div className={s.orbit} aria-hidden="true"></div>
        <a
          className={s.scanFace}
          href={url ?? `/asset/${id}`}
          tabIndex={scanning ? 0 : -1}
          aria-hidden={!scanning}
          aria-label="Open this receipt"
        >
          {url && <ReceiptQr ref={codeRef} url={url} hue={seed.hue} />}
        </a>
        <Fingerprint
          id={id}
          mode={filament ? "filament" : "pearl"}
          scanning={scanning}
          hash={seed.hash}
          media={seed.media as "image"}
          duration={seed.duration}
          hue={seed.hue}
          codeRef={codeRef}
        />
        <span className={s.scanCaption} aria-live="polite">
          {scanning ? "Scan to open this receipt" : ""}
        </span>
      </div>
      <div className={s.fingerprintAction}>
        <button type="button" disabled={!url} aria-pressed={scanning} onClick={() => setScanning((v) => !v)}>
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <path d="M2 7V2h5m6 0h5v5m0 6v5h-5m-6 0H2v-5M6 6h3v3H6zm5 5h3v3h-3zM12 6h2m-8 7h2" />
          </svg>
          {scanning ? "Back to fingerprint" : "Scan fingerprint"}
        </button>
      </div>
      <details className={s.fingerprintAbout}>
        <summary>About this fingerprint</summary>
        <p>
          Generated from this receipt’s ID, original content hash, media type, and duration. Select Scan fingerprint to open the receipt on another
          device.
        </p>
      </details>
    </div>
  );
}
