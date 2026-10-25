"use client";

import type { Ref } from "react";
import { QRCodeCanvas } from "qrcode.react";

export type ReceiptQrProps = {
  url: string;
  /** Receipt hue (0..360); modules are drawn in hsl(hue 28% 23%). */
  hue?: number;
  /** Pass the same ref to <Fingerprint codeRef> so the scan dots land on the code. */
  ref?: Ref<HTMLCanvasElement>;
};

/** 192px QR (ECC level H, 4-module quiet zone) on white, as on the receipt scan face. */
export function ReceiptQr({ url, hue = 100, ref }: ReceiptQrProps) {
  return (
    <QRCodeCanvas
      ref={ref}
      value={url}
      size={192}
      level="H"
      marginSize={4}
      bgColor="#fdfdfa"
      fgColor={`hsl(${hue} 28% 23%)`}
      title="Scan to open this receipt"
    />
  );
}
