import type { CSSProperties } from "react";
import { Globe } from "@/features/receipt/visuals/globe";
import { fingerprintSeed, type AssetReceipt, type ReceiptRow } from "./data";
import { ArrowUpRight, MotionDial } from "./glyphs";
import { ContributorAvatar, GalleryCapture, IosCapture } from "./illustrations";
import { Lifecycle } from "./lifecycle";
import { Specimen } from "./specimen";
import { CellValue, HashValue } from "./values";
import s from "./receipt.module.css";

function Breadcrumb({ receipt }: { receipt: AssetReceipt }) {
  return (
    <div className="border-b border-haze px-5 md:px-10 lg:px-20 py-3 flex items-center gap-2 mono text-[10px] uppercase tracking-[0.05em] text-slate-500 overflow-x-auto whitespace-nowrap">
      <span className="flex items-center gap-2">
        <a className="hover:text-ink transition-colors" href="/">
          Skarl
        </a>
        <span aria-hidden="true">/</span>
      </span>
      <span className="flex items-center gap-2">
        <a className="hover:text-ink transition-colors" href={receipt.app.href}>
          {receipt.app.label}
        </a>
        <span aria-hidden="true">/</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="text-ink">Receipt</span>
      </span>
    </div>
  );
}

function Hero({ receipt }: { receipt: AssetReceipt }) {
  const hue = receipt.vars["--receipt-hue"];
  const accent = receipt.vars["--receipt-accent"];
  return (
    <section className={s.hero} aria-labelledby="receipt-heading" style={{ "--receipt-hue": hue } as CSSProperties}>
      <div className={s.heroCopy}>
        <h1 id="receipt-heading">{receipt.title}</h1>
        <p className={s.description}>
          Contributed through <a href={receipt.app.href}>{receipt.app.label}</a>.
        </p>
        <div className={s.receiptIdentity}>
          <span
            className={s.miniFingerprint}
            aria-hidden="true"
            style={{ background: `repeating-conic-gradient(from ${hue}deg, ${accent} 0deg 8deg, transparent 8deg 17deg)` }}
          ></span>
          <div>
            <span className={s.label}>Source record ID</span>
            <code className={s.sourceId}>{receipt.sourceId}</code>
          </div>
        </div>
        <div className={s.dataId}>
          <span className={s.label}>Data ID</span>
          <HashValue v={receipt.id} copy={receipt.id} size="mono text-[10px] leading-[1.4]" />
        </div>
        <div className={s.heroStats}>
          {receipt.stats.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <Specimen id={receipt.id} seed={fingerprintSeed(receipt)} />
    </section>
  );
}

function Origin({ receipt }: { receipt: AssetReceipt }) {
  const { geo, capture, contributor } = receipt;
  const code = /^[A-Z]{2,3}$/.test(geo.code) ? geo.code : "";
  return (
    <section className={s.details} aria-labelledby="receipt-origin">
      <div className={s.sectionHeading}>
        <h2 id="receipt-origin">Origin</h2>
      </div>
      <div className={s.originGrid}>
        <article className={s.geoCard}>
          <div className={s.cardHeading}>
            <span>KYC country</span>
            <a
              className={s.mapSource}
              href="https://www.naturalearthdata.com/about/terms-of-use/"
              target="_blank"
              rel="noreferrer"
              aria-label="Map source: Natural Earth country boundaries"
            >
              Map source
              <ArrowUpRight size={14} strokeWidth="1.75" />
            </a>
          </div>
          <Globe countryCode={code} countryName={code ? geo.name : undefined} />
          <div className={s.geoCaption}>
            <div>
              <h3>{geo.name}</h3>
              {geo.sub && <p>{geo.sub}</p>}
            </div>
            <span className={s.countryCode}>{geo.code}</span>
          </div>
        </article>
        <article className={s.deviceCard}>
          <div className={s.cardHeading}>
            <span>Capture</span>
          </div>
          <div className={s.deviceStage}>
            {capture.kind === "ios" ? (
              <div className={s.technicalCapture} data-capture-kind="ios">
                <IosCapture label="Representative ios device technical illustration; not the contributor’s exact hardware or recorded signals." />
              </div>
            ) : (
              <div className={s.galleryVisual} data-capture-kind="file">
                <GalleryCapture />
              </div>
            )}
          </div>
          <h3>{capture.title}</h3>
          <div className={s.captureDetails}>
            <div className={s.captureFacts}>
              {capture.muted && <p className={s.muted}>{capture.muted}</p>}
              <div className={s.deviceSpecs}>
                {capture.specs.map((spec) => (
                  <span key={spec}>{spec}</span>
                ))}
              </div>
            </div>
            {capture.motion && (
              <div className={s.captureMotion}>
                <div className={s.motionDial}>
                  <MotionDial heading={capture.motion.heading} north={capture.motion.north} />
                </div>
                <div>
                  <span className={s.label}>Motion at capture</span>
                  {capture.motion.speed && <span className={s.motionSpeed}>{capture.motion.speed}</span>}
                  <p>{capture.motion.text}</p>
                </div>
              </div>
            )}
          </div>
        </article>
        <article className={s.contextCard}>
          <div className={s.cardHeading}>
            <span>Contributor</span>
          </div>
          <div className={s.contributor}>
            <div className={s.avatar} aria-hidden="true">
              <ContributorAvatar />
            </div>
            <div>
              <code>{contributor.anonId}</code>
            </div>
          </div>
          {contributor.rows.map((row) => (
            <div className={s.contextRow} key={row.label}>
              <span>{row.label}</span>
              <strong>{row.href ? <a href={row.href}>{row.v}</a> : row.v}</strong>
            </div>
          ))}
          <div className={s.contributorConsent} aria-label="Policy acceptance reported by the provider">
            {contributor.consent.map((c) => (
              <div className={s.contextRow} key={c.label}>
                <span>{c.label}</span>
                <strong className={s.policyStatus} data-recorded={c.recorded} title={c.title}>
                  {c.href ? (
                    <a href={c.href} target="_blank" rel="noreferrer" aria-label={c.aria}>
                      {c.text} <ArrowUpRight size={12} strokeWidth="1.25" />
                    </a>
                  ) : (
                    c.text
                  )}
                </strong>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function Rows({ rows }: { rows: ReceiptRow[] }) {
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-1 sm:gap-5 sm:items-baseline border-t border-haze py-4 first:border-t-0"
        >
          <span className="mono text-[10px] uppercase tracking-[0.05em] text-slate-500">{row.label}</span>
          <span className="mono text-[16px] leading-[1.4] text-ink break-words min-w-0">
            <CellValue val={row.val} />
          </span>
        </div>
      ))}
    </div>
  );
}

function Details({ receipt }: { receipt: AssetReceipt }) {
  return (
    <>
      <div className={s.sectionHeading}>
        <h2>Details</h2>
      </div>
      {receipt.groups.map((group) => (
        <details className={s.auditDetails} open key={group.summary}>
          <summary>{group.summary}</summary>
          <section className="px-5 md:px-10 lg:px-20 pb-10 md:pb-12 lg:pb-16">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 border-t border-haze pt-10 md:pt-12 lg:pt-16">
              {group.columns.map((col) => (
                <div className="flex flex-col gap-5" key={col.heading}>
                  <h2 className="cut-regular text-[clamp(24px,3.5vw,32px)] tracking-[-0.03em] leading-[0.95] text-ink">{col.heading}</h2>
                  {col.empty ? <p className="cut-book text-[16px] leading-[1.2] text-slate-500">{col.empty}</p> : <Rows rows={col.rows} />}
                </div>
              ))}
            </div>
          </section>
        </details>
      ))}
    </>
  );
}

function History({ receipt }: { receipt: AssetReceipt }) {
  return (
    <section className={s.history} aria-labelledby="metadata-history-heading">
      <div className={s.historyHeading}>
        <h2 id="metadata-history-heading">Metadata updates</h2>
        <span className={s.sequenceBadge}>{receipt.history.badge}</span>
      </div>
      <ol className={s.metadataTimeline}>
        {receipt.history.entries.map((entry) => (
          <li className={s.historyEntry} key={entry.seq}>
            <span className={s.historyNode} aria-hidden="true">
              <svg viewBox="0 0 16 16">
                <path d="m4 8 2.5 2.5L12 5" />
              </svg>
            </span>
            <div className={s.entryCard}>
              <div className={s.entryHeading}>
                <div>
                  <span className={s.entrySequence}>{entry.seq}</span>
                  <h3>{entry.title}</h3>
                </div>
                <time dateTime={entry.datetime}>{entry.time}</time>
              </div>
              <p className={s.historyUnchanged}>{entry.note}</p>
              <details className={s.proofDetails} open>
                <summary>Proof &amp; transaction</summary>
                <div className={s.proofContent}>
                  {entry.proof.map((line) => (
                    <div className={s.proofLine} key={line.label}>
                      <span>{line.label}</span>
                      {(line.val.k === "hash" || line.val.k === "tx") && (
                        <HashValue
                          v={line.val.v}
                          prefix={line.val.prefix}
                          href={line.val.k === "tx" ? line.val.href : undefined}
                          copy={line.val.copy}
                          size="mono text-[10px] leading-[1.4]"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CurrentMetadata({ receipt }: { receipt: AssetReceipt }) {
  const href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(receipt.record, null, 2));
  return (
    <details className={s.auditDetails} open>
      <summary>Current metadata &amp; JSON download</summary>
      <section className="px-5 md:px-10 lg:px-20 pb-12 md:pb-16 lg:pb-20">
        <div className="border-t border-haze pt-10 md:pt-12 lg:pt-16">
          <div className="flex items-baseline justify-between gap-4 mb-6 flex-wrap">
            <div>
              <h2 className="cut-regular text-[clamp(24px,3.5vw,32px)] tracking-[-0.03em] leading-[0.95] text-ink mt-2">Current metadata</h2>
            </div>
            <a
              href={href}
              download={`receipt-${receipt.id}.json`}
              className="inline-flex items-center justify-center mono uppercase tracking-[0.05em] whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed h-7 px-3 text-[12px] gap-2 bg-transparent text-ink border border-haze hover:bg-ink/5 transition-colors "
            >
              Download JSON
            </a>
          </div>
          <pre className="mono text-[11px] leading-[1.7] text-ink bg-mist rounded-[2px] border border-haze p-4 sm:p-6 overflow-x-auto">
            {JSON.stringify(receipt.record.initial_metadata_json, null, 2)}
          </pre>
        </div>
      </section>
    </details>
  );
}

/** Full asset receipt page body (inside the shared main). */
export function AssetReceiptView({ receipt }: { receipt: AssetReceipt }) {
  return (
    <>
      <Breadcrumb receipt={receipt} />
      <div className={`${s.lab} ${s.live}`} style={receipt.vars as CSSProperties}>
        <Hero receipt={receipt} />
        <Origin receipt={receipt} />
        <Lifecycle receipt={receipt} />
        <Details receipt={receipt} />
        <History receipt={receipt} />
        <CurrentMetadata receipt={receipt} />
      </div>
    </>
  );
}
