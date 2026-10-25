# Runtime Configuration

Task content and commercial terms come from stored order data. Configuration selects deployment origins, providers and operating limits. There is no configured fallback task spec. Convex remains the system of record; Base Sepolia remains the primary funding rail and only payout target, with optional Solana Devnet funding.

Defaults below describe source behavior, not deployed settings. No deployment or production backfill was performed by this change. Secret values are intentionally omitted. `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` values are public; never put credentials in them. Monetary values ending in `ATOMIC` or `MICRO_USD` are decimal integer micro-units, parsed as `bigint`, never floating point.

## Task extraction and migration

Order creation freezes the rubric and commercial terms, stores `taskSpecStatus: pending`, and schedules extraction from that order's rubric criterion descriptions. Caller-supplied task labels cannot become trusted semantics. The provider result must satisfy the task schema and normalization checks before the order and frozen rubric become `ready`. Metadata records extraction version `rubric-task-spec-v1`, original rubric content hash, provider, model and time; `taskSpecHash` binds that version, rubric hash and extracted spec. Provider failure, invalid JSON/schema or unavailable semantics leaves the order pending and verification review-only. The extractor never guesses a task or approves acceptance/payment.

`orders:backfillTaskSpecs` visits existing orders in `awaiting_funding`, `funded` and `collecting`, extracts from each order's own frozen criteria and returns ready/pending/skipped counts. It is safe to rerun after provider recovery: current ready version/hash bindings are skipped, and a delayed failed result cannot erase a ready result. Original rubric content hashes, commercial terms and historical reports remain unchanged. Old reports remain readable; new scoped verification requires the trusted bound spec.

After an operator separately deploys this source to the intended production deployment, configure the shared payment origin and run the migration:

```sh
pnpm exec convex env set SKARL_PAYMENT_ORIGIN https://skarl.vercel.app --prod
pnpm exec convex run orders:backfillTaskSpecs '{}' --prod
```

If the production Gemini secret is absent, supply it from a privately populated operator environment; do not paste it into source, reports or logs:

```sh
: "${GEMINI_API_KEY:?populate the operator secret environment first}"
pnpm exec convex env set GEMINI_API_KEY "$GEMINI_API_KEY" --prod
```

`GEMINI_TASK_SPEC_MODEL` defaults to `GEMINI_FINANCE_MODEL`, whose default is `gemini-3.8-flash`. To pin extraction explicitly, choose a provider-supported configured model and run:

```sh
: "${GEMINI_TASK_SPEC_MODEL:?choose the extraction model}"
pnpm exec convex env set GEMINI_TASK_SPEC_MODEL "$GEMINI_TASK_SPEC_MODEL" --prod
```

The backfill calls the provider and changes extracted metadata. It does not reprocess past submissions, accept work, create payables or transfer funds. Rerun the same backfill command to retry pending specs; submit new licensed media for new verification evidence. Deploying source, exercising live inference and observing chain settlement are separate operator steps.

## Convex origins, identifiers and models

`SKARL_DETECTOR_CLASSES` defaults to the COCO class vocabulary listed in `convex/lib/config.ts`; it is the configurable supported detector-label list used by task-scoped advisory object witnesses. Descriptor-prefixed task labels map only to a configured exact class suffix. Unsupported classes abstain.

These defaults live in `convex/lib/config.ts`, except the extraction-specific model in `convex/taskSpecExtraction.ts`. Configure them on the Convex deployment. String defaults use trimmed nonempty environment values; lists are comma-separated. Changing a deployment label does not migrate business rows automatically.

| Key | Default | Used by |
| --- | --- | --- |
| `GEMINI_API_URL` | `https://generativelanguage.googleapis.com/v1beta/interactions` | Gemini transport endpoint |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Claude SDK endpoint |
| `CDP_SQL_API_URL` | `https://api.cdp.coinbase.com/platform/v2/data/query/run` | CDP indexed transfer witness endpoint |
| `NESSIE_API_URL` | `https://prod-api.nessieisreal.com` | Simulated-bank witness endpoint |
| `SKARL_QUALITY_WEIGHTS` | JSON object: `juryAgreement:25`, `allCriteriaSupported:25`, `duplicateClear:20`, `livenessPassed:15`, `sensorSteadiness:5`, `attestationPresent:10` | Sample ranking heuristic in `convex/lib/sampleQuality.ts`; exact keys, nonnegative integers totaling 100; never payment authority |
| `SKARL_APP_ORIGIN` | `https://skarl.devshardat.work` | Contributor links, agent discovery, wallet-origin default |
| `SKARL_WALLET_MCP_ORDER_KEY` | `wallet-mcp-agent-order-v1` | Internal agent treasury order idempotency key |
| `SKARL_WALLET_MCP_REQUEST_ID` | `00000000-0000-4000-8000-000000000001` | Internal agent treasury order request ID |
| `SKARL_PAYMENT_ORIGIN` | `https://skarl.vercel.app` | MCP funding links, wallet-origin default; set the same key on the web server |
| `SKARL_AGENT_ORIGIN` | `https://keen-marmot-986.convex.site` | MCP/discovery URLs |
| `SKARL_WALLET_ORIGINS` | App origin and payment origin | SIWE and MCP allowed origins |
| `SKARL_DEMO_ORDER_PUBLIC_ID` | `skarl-red-cup-demo-v2` | Selects a stored public template in orders/dashboard/health/payments; contains no task spec |
| `SKARL_LEGACY_DEMO_ORDER_PUBLIC_ID` | `skarl-red-cup-demo-v1` | Legacy stored order selection and fixture classification |
| `SKARL_PUBLIC_ORDER_PREFIX` | `skarl-outsider-demo-` | Public order identifiers and visibility |
| `SKARL_FIXTURE_ORDER_PREFIXES` | `scenario:`, public-order prefix, `skarl-red-cup-demo-sol`, legacy-order ID | Health/analytics fixture classification |
| `SKARL_DEMO_ORGANIZATION_KEY` | `skarl-demo-v1` | Seed organization lookup |
| `SKARL_VERIFIER_IDENTITY` | `gemini-verifier` | Verifier audit actor |
| `GEMINI_VIDEO_MODEL` | `gemini-4-argon` | Single-model visual verification |
| `GEMINI_FINANCE_MODEL` | `gemini-3.8-flash` | Gemini finance, chat/coach and extraction fallback |
| `GEMINI_AUDIO_MODEL` | `gemini-3.5-transcribe` | Audio-only evidence |
| `GEMINI_TRANSCRIPTION_MODEL` | `gemini-3.5-transcribe` | Selects native word-timestamp transcription adapter |
| `GEMINI_TASK_SPEC_MODEL` | Configured finance model | Rubric-to-task extraction |
| `GEMINI_EVALUATION_MODELS` | Configured video and finance models | Independent visual jury and paired evaluation; 2–16 unique valid model IDs |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Claude provider base model |
| `ANTHROPIC_FINANCE_MODEL` | `ANTHROPIC_MODEL` | Claude finance override; analyst metadata currently retains its separately owned matching default |
| `EAS_ALLOWED_VIDEO_MODELS` | Evaluation models plus `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-2.5-flash`, `gemini-2.0-flash` | EAS model allowlist |
| `EAS_ALLOWED_PIPELINE_PATTERN` | `^(task-evidence-2\.0\|red-cup-evidence-[0-9]+\.[0-9]+(?:\.[0-9]+)?)$` | EAS pipeline allowlist; historical versions remain readable |
| `SKARL_LIVENESS_WORDS` | The fixed 128-word vocabulary in `convex/lib/config.ts` | Random spoken challenges; no task vocabulary is inferred from it |
| `FINANCE_AGENT_MAX_BATCH_ATOMIC` | `10000000` | Maximum proposed finance batch in micro-USDC |
| `EAS_ATTESTOR_NAME` | `skarl-attestor` | CDP attestor account lookup |
| `EAS_ADDRESS` | `0x4200000000000000000000000000000000000021` | Existing Base EAS contract |
| `EAS_SCHEMA_REGISTRY_ADDRESS` | `0x4200000000000000000000000000000000000020` | Existing EAS registry |
| `SKARL_TAX_REPORTING_THRESHOLD_MICRO_USD` | `600000000` | Contributor reporting flag; not a tax-compliance determination |
| `BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` | Chain health/reconciliation and operator/buyer RPC; package buyer defaults to the same viem chain URL |

## Convex numeric operating limits

All values below are read through `configNumber` in `convex/lib/config.ts`. Integers must be safe integers and meet their configured minimum; invalid configuration throws. Gyroscope thresholds may be fractional. Names ending in `_MS` use milliseconds; byte limits use bytes. Rate refill values are tokens per minute. Resource limits, retry windows and heuristic thresholds are operating choices, not measured accuracy guarantees.

| Key | Default | Used by |
| --- | --- | --- |
| `SKARL_COACH_RETRY_COOLDOWN_MS` | `60000` | `convex/coachData.ts` |
| `SKARL_COACH_LEASE_MS` | `90000` | `convex/coachData.ts` |
| `SKARL_CHAIN_SNAPSHOT_COOLDOWN_MS` | `30000` | `convex/chainWitness.ts` |
| `SKARL_CHAIN_SNAPSHOT_FRESH_MS` | `120000` | `convex/chainWitness.ts` |
| `SKARL_AGENT_CHAT_DEADLINE_MS` | `120000` | `convex/agentChat.ts` |
| `SKARL_AGENT_CHAT_LEASE_MS` | `180000` | `convex/agentChatData.ts` |
| `SKARL_FINANCE_AGENT_LEASE_MS` | `180000` | `convex/financeAgentData.ts`, `convex/scheduledData.ts` |
| `SKARL_FINANCE_AGENT_MAX_ALLOWED_TOOL_CALLS` | `24` | `convex/financeAgentData.ts` |
| `FINANCE_AGENT_MAX_BATCH_SIZE` | `20` | Proposal registry validation and durable batch mutation (`convex/lib/financeToolRegistry.ts`, `convex/financeAgentData.ts`) |
| `SKARL_FINANCE_TICK_LEASE_MS` | `540000` | `convex/scheduledData.ts` |
| `SKARL_RECONCILIATION_TICK_LEASE_MS` | `110000` | `convex/scheduledData.ts` |
| `SKARL_BANK_TICK_LEASE_MS` | `90000` | `convex/scheduledData.ts` |
| `SKARL_VERIFICATION_LEASE_MS` | `300000` | `convex/submissions.ts` |
| `SKARL_HEALTH_FINANCE_FRESH_MS` | `1500000` | `convex/health.ts` |
| `SKARL_HEALTH_PROBE_FRESH_MS` | `300000` | `convex/health.ts` |
| `SKARL_HEALTH_INTEGRATION_FRESH_MS` | `86400000` | `convex/health.ts` |
| `SKARL_HEALTH_JIRA_FRESH_MS` | `900000` | `convex/health.ts` |
| `SKARL_PUBLIC_CATALOG_LIMIT` | `25` | Public catalog page size (`convex/mcpPublic.ts`) |
| `SKARL_LIVENESS_CHALLENGE_TTL_MS` | `120000` | `convex/liveness.ts`, `convex/lib/spokenLiveness.ts` |
| `SKARL_LIVENESS_WORD_COUNT` | `3` | `convex/liveness.ts`, `convex/lib/spokenLiveness.ts` |
| `FINANCE_AGENT_MAX_TOOL_CALLS` | `24` | Shared proposal, read-only chat and analyst budget (`convex/lib/financeAgentBudget.ts`) |
| `FINANCE_AGENT_CONTEXT_CHARS` | `80000` | Shared context budget; schema envelope is 32000–100000 characters (`convex/lib/financeAgentBudget.ts`) |
| `FINANCE_AGENT_MIN_CONTEXT_CHARS` | `32000` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `FINANCE_AGENT_MAX_CONTEXT_CHARS` | `100000` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `FINANCE_AGENT_SUMMARY_FACT_LIMIT` | `18` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `FINANCE_AGENT_SUMMARY_FACT_CHARS` | `180` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `FINANCE_AGENT_WRAPUP_CHARS` | `3600` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `FINANCE_AGENT_UNKNOWN_RESULT_CHARS` | `6000` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `FINANCE_AGENT_RESULT_ENVELOPE_CHARS` | `1000` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `SKARL_FINANCE_TOOL_PAGE_SIZE` | `30` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `SKARL_FINANCE_PRIOR_NOTE_LIMIT` | `12` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `SKARL_FINANCE_WALLET_AUDIT_LIMIT` | `500` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `SKARL_FINANCE_AUDIT_SCAN_LIMIT` | `2000` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `SKARL_FINANCE_CRON_HISTORY_LIMIT` | `20` | Shared finance context, result compaction and read bounds (`convex/lib/financeAgentBudget.ts`, `convex/lib/financeToolRegistry.ts`, `convex/financeToolRead.ts`) |
| `SKARL_FINANCE_TOOL_READ_LIMIT` | `250` | Bounded scoped finance reads (`convex/financeToolRead.ts`) |
| `FINANCE_AGENT_DEADLINE_RESERVE_MS` | `1500` | Deterministic wrap-up reserve (`convex/lib/financeAgentLoop.ts`) |
| `FINANCE_AGENT_LOOP_CONTEXT_CHARS` | `65000` | Loop fallback context when no caller budget is supplied (`convex/lib/financeAgentLoop.ts`) |
| `FINANCE_AGENT_TOOL_RESULT_CHARS` | `12000` | Default shared tool-result bound (`convex/lib/financeToolRegistry.ts`) |
| `FINANCE_AGENT_DETAILED_RESULT_CHARS` | `18000` | Journal and witness receipt result bound (`convex/lib/financeToolRegistry.ts`) |
| `ANTHROPIC_REQUEST_TIMEOUT_MS` | `30000` | `convex/lib/claude.ts` |
| `GEMINI_REQUEST_TIMEOUT_MS` | `30000` | `convex/lib/gemini.ts` |
| `SKARL_ATTEMPTS_PER_ORDER` | `4` | `convex/scheduledData.ts` |
| `SKARL_BANK_FRESH_MS` | `300000` | `convex/bankWitness.ts` |
| `SKARL_BUCKET_MS` | `300000` | `convex/analytics.ts` |
| `SKARL_CDPSQL_MAX_ROWS` | `10000` | `convex/lib/cdpSql.ts` |
| `SKARL_DERIVEDANNOTATIONS_MAX_ANNOTATION_BYTES` | `5242880` | `convex/lib/derivedAnnotations.ts` |
| `SKARL_DERIVEDANNOTATIONS_MAX_ANNOTATION_FRAMES` | `2000` | `convex/lib/derivedAnnotations.ts` |
| `SKARL_DISCOVERY_RATE_CAPACITY` | `600` | `convex/lib/publicRateLimit.ts` |
| `SKARL_DISCOVERY_RATE_REFILL` | `600` | `convex/lib/publicRateLimit.ts` |
| `SKARL_DUPLICATE_CANDIDATE_LIMIT` | `200` | `convex/submissions.ts`, `convex/finance.ts` |
| `SKARL_DUPLICATE_MAX_FRAME_DISTANCE` | `10` | `convex/lib/copyDetection.ts` |
| `SKARL_DUPLICATE_MAX_MEAN_DISTANCE` | `6` | `convex/lib/copyDetection.ts` |
| `SKARL_FINANCE_AGENT_DEADLINE_MS` | `120000` | `convex/financeAgent.ts` |
| `SKARL_FINANCE_INTERVAL_MS` | `600000` | `convex/scheduledData.ts` |
| `SKARL_IDEMPOTENCY_RETRY_MS` | `82800000` | `convex/lib/easSender.ts` |
| `SKARL_JIRA_RATE_CAPACITY` | `120` | `convex/lib/publicRateLimit.ts` |
| `SKARL_JIRA_RATE_REFILL` | `120` | `convex/lib/publicRateLimit.ts` |
| `SKARL_LEASE_MS` | `180000` | `convex/attestations.ts` |
| `SKARL_MCP_RATE_CAPACITY` | `240` | `convex/lib/publicRateLimit.ts` |
| `SKARL_MCP_RATE_REFILL` | `240` | `convex/lib/publicRateLimit.ts` |
| `SKARL_MEDIA_FRAME_SAMPLES` | `6` | `convex/lib/media.ts` |
| `SKARL_MEDIA_MAX_AUDIO_BYTES` | `2097152` | `convex/lib/media.ts` |
| `SKARL_MEDIA_MAX_BINARY_BYTES` | `104857600` | `convex/lib/media.ts` |
| `SKARL_MEDIA_MAX_DURATION_MS` | `30000` | `convex/submissions.ts`, `convex/lib/media.ts` |
| `SKARL_MEDIA_MAX_INPUT_BYTES` | `26214400` | `convex/submissions.ts`, `convex/lib/media.ts` |
| `SKARL_MEDIA_MAX_JPEG_BYTES` | `102400` | `convex/lib/gemini.ts`, `convex/lib/media.ts` |
| `SKARL_MEDIA_MAX_VIDEO_BYTES` | `12582912` | `convex/lib/media.ts` |
| `SKARL_MEDIA_VISUAL_SAMPLES` | `12` | `convex/lib/gemini.ts`, `convex/lib/media.ts` |
| `SKARL_NESSIE_MAX_ROWS` | `5000` | `convex/lib/nessie.ts` |
| `SKARL_ORDERS_PER_TICK` | `3` | `convex/scheduledData.ts` |
| `SKARL_PAYMENT_APPROVAL_TTL_MS` | `3600000` | `convex/finance.ts` |
| `SKARL_QUALITY_REVIEW_SCORE_CAP` | `49` | `convex/lib/sampleQuality.ts` |
| `SKARL_QUALITY_SEGMENT_PADDING_MS` | `500` | `convex/lib/sampleQuality.ts` |
| `SKARL_RECONCILIATION_INTERVAL_MS` | `120000` | `convex/scheduledData.ts` |
| `SKARL_RETRY_MS` | `120000` | `convex/attestations.ts` |
| `SKARL_SENSORTRACE_MAX_SENSOR_TRACE_BYTES` | `2097152` | `convex/lib/sensorTrace.ts` |
| `SKARL_SENSORTRACE_STEADY_GYRO_RAD_PER_SEC` | `0.15` | `convex/lib/sensorTrace.ts` |
| `SKARL_WALLET_CHALLENGE_TTL_MS` | `300000` | `convex/contributorWallet.ts` |
| `VERIFIER_MAX_ACTIONS` | `64` | `convex/lib/verificationReport.ts` |
| `VERIFIER_MAX_RAW_LENGTH` | `64000` | `convex/lib/verificationReport.ts` |
| `VERIFIER_MAX_SEGMENTS` | `256` | `convex/lib/verificationReport.ts`, `convex/lib/spokenLiveness.ts` |
| `VERIFIER_MAX_TEXT_LENGTH` | `16000` | `convex/lib/verificationReport.ts` |
| `VERIFIER_PRONOUN_WINDOW_MS` | `4000` | `convex/lib/verificationReport.ts` |
| `VERIFIER_TEMPORAL_TOLERANCE_MS` | `2000` | `convex/lib/verificationReport.ts` |

## Web runtime configuration

`NEXT_PUBLIC_*` values are inlined during the Next.js build. `SKARL_*` values are server-only. Numeric settings must be positive finite numbers. Task text and commercial amounts come from source order data; no environment key supplies a default task spec.

| Key | Default | Used by |
| --- | --- | --- |
| `NEXT_PUBLIC_SKARL_ORIGIN` | `"https://skarl.devshardat.work"` | public connection/links (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `"https://keen-marmot-986.convex.site"` | public connection/links (`apps/web/lib/config.ts`) |
| `SKARL_MEDIA_FETCH_TIMEOUT_MS` | `30_000` | web server request/reconciliation bounds (`apps/web/lib/config.ts`) |
| `SKARL_RECONCILE_LOOKBACK_BLOCKS` | `"10000"` | web server request/reconciliation bounds (`apps/web/lib/config.ts`) |
| `SKARL_RECONCILE_CHUNK_BLOCKS` | `"1000"` | web server request/reconciliation bounds (`apps/web/lib/config.ts`) |
| `SKARL_PUBLIC_ORDER_BODY_MAX_BYTES` | `512` | web server request/reconciliation bounds (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_MAX_DURATION_MS` | `30_500` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_MAX_BYTES` | `8 * 1024 * 1024` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_FRAME_TOLERANCE_MS` | `150` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_MAX_TRACE_MS` | `31_000` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_MAX_SAMPLES` | `31_000` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_MAX_SENSOR_MAGNITUDE` | `10_000` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_EVIDENCE_TEXT_MAX` | `2000` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_EVIDENCE_ROWS_MAX` | `100` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_JUDGE_MAX` | `16` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_MOTION_BIN_MS` | `100` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_GYRO_THRESHOLD_RAD_PER_SEC` | `0.15` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_MEDIAPIPE_VERSION` | `"1.1.1"` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_MEDIAPIPE_WASM_ROOT` | unset; derives from `NEXT_PUBLIC_MEDIAPIPE_VERSION` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_HAND_MODEL_NAME` | `"MediaPipe Hand Landmarker"` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_HAND_MODEL_VERSION` | `"float16/1"` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_HAND_MODEL_URL` | `"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_OBJECT_MODEL_NAME` | `"MediaPipe EfficientDet-Lite0"` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_OBJECT_MODEL_VERSION` | `"float32/1"` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_OBJECT_MODEL_URL` | `"https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite"` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_SEGMENT_MODEL_NAME` | `"SAM2.1 Hiera Tiny"` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_SEGMENT_MODEL_REPOSITORY` | `"onnx-community/sam2.1-hiera-tiny-ONNX"` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_SEGMENT_MODEL_REVISION` | `"814a066640debee5a91e70aa401fb8e17e030503"` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_HAND_DETECTION_CONFIDENCE` | `0.5` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_HAND_PRESENCE_CONFIDENCE` | `0.5` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_HAND_TRACKING_CONFIDENCE` | `0.5` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_OBJECT_SCORE_THRESHOLD` | `0.4` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_OBJECT_MAX_RESULTS` | `15` | browser replay (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_MAX_HANDS` | `2` | browser replay (`apps/web/lib/config.ts`) |
| `SKARL_PAYMENT_ORIGIN` | `"https://skarl.vercel.app"` | hosted payment resource and error links; retains previous origin (`apps/web/lib/config.ts`) |

## Mobile public configuration

`EXPO_PUBLIC_*` values are public Expo build/runtime configuration. Restart Expo or rebuild after changes. These are capture and coaching limits only; server limits and acceptance authority remain independent.

| Key | Default | Used by |
| --- | --- | --- |
| `EXPO_PUBLIC_CAPTURE_MIN_MS` | `10_000` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_CAPTURE_MAX_MS` | `30_000` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_CAPTURE_MAX_BYTES` | `24 * 1024 * 1024` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_GYRO_THRESHOLD_RAD_PER_SEC` | `0.15` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_SUSTAINED_MOTION_MS` | `500` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_MAX_SAMPLE_GAP_MS` | `250` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_STALE_MOTION_MS` | `500` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_TILT_THRESHOLD_DEGREES` | `15` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_HORIZON_MIN_PROJECTION_RATIO` | `0.1` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_UPLOAD_MAX_VIDEO_BYTES` | `25 * 1024 * 1024` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_UPLOAD_MAX_TRACE_BYTES` | `2 * 1024 * 1024` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_UPLOAD_TIMEOUT_MS` | `120_000` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_TRACE_MAX_DURATION_MS` | `31_000` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_SENSOR_INTERVAL_MS` | `20` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_MAX_STEP_LABELS` | `100` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_MAX_STEP_LABEL_LENGTH` | `160` | mobile capture, upload, sensors or coaching (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_NEW_TASK_WINDOW_MS` | `7 * 24 * 60 * 60 * 1000` | Mobile task freshness badge (`apps/mobile/src/data.ts`) |

### Additional web keys

| Key | Default | Used by |
| --- | --- | --- |
| `NEXT_PUBLIC_CAPTURE_MIN_SECONDS` | `10` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_CAPTURE_MAX_SECONDS` | `30` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_CAPTURE_MAX_BYTES` | `25 * 1024 * 1024` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_CAPTURE_VIDEO_BITS_PER_SECOND` | `2_500_000` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_CAPTURE_WIDTH` | `1280` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_CAPTURE_HEIGHT` | `720` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_CAPTURE_FRAME_RATE` | `30` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_UPLOAD_TIMEOUT_MS` | `120_000` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `SKARL_MEDIA_TOKEN_MAX_LENGTH` | `2048` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `BASE_SEPOLIA_RPC_URL` | `"https://sepolia.base.org"` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `SKARL_RPC_TIMEOUT_MS` | `15_000` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `SKARL_RPC_RETRY_COUNT` | `1` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `SKARL_RECEIPT_TIMEOUT_MS` | `20_000` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `SKARL_WEBHOOK_MAX_BYTES` | `64_000` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `SKARL_WEBHOOK_HEADER_MAX_LENGTH` | `2048` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `SKARL_WEBHOOK_TOLERANCE_MS` | `300_000` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `SKARL_DATASET_REFRESH_MS` | `60_000` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `SKARL_HEALTH_TIMEOUT_MS` | `5_000` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |
| `NEXT_PUBLIC_REPLAY_DECODE_TIMEOUT_MS` | `20_000` | web capture, upload, chain reconciliation, media grants and request bounds (`apps/web/lib/config.ts`) |

### Additional mobile keys

| Key | Default | Used by |
| --- | --- | --- |
| `EXPO_PUBLIC_LIVENESS_MIN_REMAINING_MS` | `60_000` | mobile capture/liveness (`apps/mobile/src/config.ts`) |
| `EXPO_PUBLIC_VIDEO_BITS_PER_SECOND` | `4_000_000` | mobile capture/liveness (`apps/mobile/src/config.ts`) |

Media grant TTL uses shared `SKARL_MEDIA_TOKEN_TTL_MS` (default `300000` ms) from `packages/payments/src/config.ts`; web issue/verify use the same value. Next route `maxDuration` values remain static compile-time platform limits because Next requires literal exports.

Web receipt polling reuses `paymentConfig.requiredConfirmations` (`SKARL_REQUIRED_CONFIRMATIONS`, default `2`) from the shared payment config.


## Shared payments and operator configuration

`packages/payments/src/config.ts` validates money as canonical positive integer micro-USDC within Int64 and counts/durations as positive safe integers. Configure shared prices/limits consistently in Convex, the web server and buyer/operator environments. Configuring a price does not change an existing stored payment intent; quote binding still prevents changing an in-flight attempt.

| Key | Default | Used by |
| --- | --- | --- |
| `SKARL_CDP_SPEND_WINDOW_MS` | `86_400_000` | Persistent buyer cumulative-spend reservation window |
| `SKARL_SOLANA_FAUCET_MAX_CLAIMS` | `2` | Operator/buyer maximum durable USDC faucet requests per Solana account |
| `SKARL_REQUIRED_CONFIRMATIONS` | `2` | Transfer validation and CDP SQL witness; web reconciliation uses the shared value |
| `SKARL_PUBLIC_ORDER_IP_LIMIT` | `3` | Durable public order per-IP quota |
| `SKARL_PUBLIC_ORDER_GLOBAL_LIMIT` | `30` | Durable global public order quota |
| `SKARL_PUBLIC_ORDER_WINDOW_MS` | `3_600_000` | Public quota window |
| `SKARL_MEDIA_TOKEN_TTL_MS` | `300_000` | Dataset/evidence media grant issue and verification |
| `SKARL_FUNDING_TIMEOUT_SECONDS` | `300` | Base x402 offer timeout |
| `SKARL_SOLANA_FUNDING_TIMEOUT_SECONDS` | `60` | Solana x402 offer timeout |
| `SKARL_FACILITATOR_CACHE_TTL_MS` | `30_000` | Funding facilitator supported-scheme cache |
| `SKARL_EVIDENCE_PRICE_ATOMIC` | `250000` | Evidence quote, durable sale attempt and buyer validation |
| `SKARL_CDP_MAX_CUMULATIVE_ATOMIC` | `20000000` | Persistent buyer spend reservations for both rails |
| `SKARL_BUYER_AUTO_PAY_CAP_ATOMIC` | `1000000` | CLI --create default chosen buyer cap |
| `SKARL_BUYER_IDENTITY` | `buyer` | Legacy buyer CLI/operator requests and demo operator scripts |
| `SKARL_CDP_BUYER_ACCOUNT` | `skarl-buyer-sepolia` | CDP EVM buyer account |
| `SKARL_CDP_SOLANA_BUYER_ACCOUNT` | `skarl-buyer-devnet` | CDP Solana buyer account |
| `SKARL_APP_URL` | `http://localhost:3000` in payment buyer config; required by webhook creation unless URL argument supplied | Buyer CLI resource origin and operator scripts |
| `SKARL_ORDER_ID` | Unset; explicit CLI order argument required otherwise | Funding CLIs; never chooses an order implicitly |
| `SKARL_CONTRIBUTOR_IDENTITY` | `contributor` | Sample/evaluation operator scripts via `scripts/config.mjs` |
| `SKARL_FINANCE_IDENTITY` | `finance-agent` | End-to-end operator script via `scripts/config.mjs` |
| `SKARL_FINANCE_TOKEN_IDENTIFIER` | `demo:skarl:finance-agent` | End-to-end audit assertion via `scripts/config.mjs` |
| `SKARL_CDP_AGENT_ACCOUNT` | `skarl-finance-agent` | Policy management agent account via `scripts/config.mjs` |
| `SKARL_CDP_POLICY_PROBE_ACCOUNT` | `skarl-policy-probe` | Independent policy-probe account via `scripts/config.mjs` |
| `SKARL_EAS_REGISTRAR_ACCOUNT` | `skarl-eas-registrar` | EAS schema registration via `scripts/config.mjs` |
| `SKARL_ATTESTOR_FAUCET_MINIMUM_WEI` | `20000000000000` | Operator attestor faucet threshold in wei; separate from USDC |
| `SKARL_FUNDING_TX` | Unset; explicit transaction argument required otherwise | Read-only CDP SQL witness; no historical transaction or treasury fallback |
| `SOLANA_DEVNET_RPC_URL` | `https://api.devnet.solana.com` | Funding-only Solana authorization/reconciliation |
| `X402_FACILITATOR_URL` | `https://x402.org/facilitator` when CDP credentials are absent | Funding facilitator; authenticated CDP failures never downgrade |

## Credentials, feature switches and platform inputs

Unset credentials disable or refuse the corresponding operation. Required means required for that feature, not that a secret should be added to every runtime. The independent CDP wallet policy, stored buyer rule and approved payment intent continue to bound payouts. Public origins and UI settings confer no financial authority.

| Key | Default | Used by |
| --- | --- | --- |
| `GEMINI_API_KEY` | Unset; required for extraction/verifier/Gemini inference | Convex provider secret |
| `ANTHROPIC_API_KEY` | Unset; required for Claude inference | Convex Claude finance/analyst provider secret |
| `SKARL_PAYMENTS_SERVICE_SECRET` | Unset; at least 32 characters required | Shared web/Convex payment-service authentication, media grants and IP digests |
| `SKARL_TREASURY_ADDRESS` | Unset; required for funding | Web/buyer/operator treasury destination; never model-supplied |
| `SKARL_SOLANA_TREASURY_ADDRESS` | Unset; optional rail unavailable otherwise | Solana funding destination |
| `SKARL_EVIDENCE_PAYTO` | Unset; required for evidence sales | Separate evidence revenue wallet; must differ from treasury |
| `CDP_API_KEY_ID` | Unset; required with secret | CDP authenticated facilitator and wallet management |
| `CDP_API_KEY_SECRET` | Unset; required with ID | CDP authenticated facilitator and wallet management |
| `CDP_WALLET_SECRET` | Unset; required for CDP signing | CDP managed wallet operations in trusted executor/operator environment |
| `CDP_CLIENT_API_KEY` | Unset; witness unavailable otherwise | CDP indexed-transfer SQL API |
| `CDP_AGENT_ADDRESS` | Unset; executor refuses otherwise | Finance CDP account and proof/health binding |
| `CDP_AGENT_POLICY_ID` | Unset; executor refuses otherwise | Independently enforced payout wallet policy |
| `CDP_PAYOUT_CAP_ATOMIC` | Unset; policy setup refuses otherwise | Independent positive Int64 micro-USDC payout policy cap |
| `PAYOUT_EXECUTOR` | `controller_wallet` projection unless `cdp_agent` is selected | Legacy browser-wallet path versus trusted CDP execution |
| `CDP_WEBHOOK_SECRET_TO` | Unset | Web CDP incoming-transfer webhook signature verification |
| `CDP_WEBHOOK_SECRET_FROM` | Unset | Web CDP outgoing-transfer webhook signature verification |
| `CDP_WEBHOOK_SECRET` | Unset | Legacy webhook signature-secret compatibility |
| `CONVEX_URL` | Unset; may fall back to NEXT_PUBLIC_CONVEX_URL in operator scripts | Explicit intended Convex deployment; local file lookup supported by clip scripts |
| `NEXT_PUBLIC_CONVEX_URL` | Unset; web shows configuration state without it | Web Convex client, auth proxy and payment routes |
| `EXPO_PUBLIC_CONVEX_URL` | Unset; mobile shows configuration state without it | Mobile Convex client |
| `CONVEX_SITE_URL` | Unset; supplied by Convex/auth deployment | Auth issuer and operator preflight site origin |
| `AUTH_GOOGLE_ID` | Unset | Convex Auth Google OAuth client |
| `AUTH_GOOGLE_SECRET` | Unset | Convex Auth Google OAuth secret |
| `JWT_PRIVATE_KEY` | Unset | Convex Auth token signing key |
| `JWKS` | Unset | Convex Auth verification keys |
| `SITE_URL` | Unset | Auth redirect allowlist and health public-site link |
| `SKARL_CONTROLLER_EMAILS` | Empty list | Auth-only controller bootstrap allowlist; comma-separated emails |
| `SKARL_DEMO_IDENTITIES` | Enabled unless exactly `off` | Unsigned compatibility identities in auth membership module |
| `SKARL_MCP_KEYS` | Unset; guest access only | JSON hash-to-role mapping for privileged MCP tool scopes |
| `SKARL_JIRA_FEED_SECRET` | Unset; 32–512 characters required | Authenticated Jira/health feed exports |
| `SKARL_JIRA_PUBLIC_URL` | Configured app origin | Public witness receipt links in Jira feed |
| `VERIFIER_JURY` | Enabled unless exactly `off` | Independent visual jury; explicit evaluation model uses a single-model arm |
| `FINANCE_AGENT_PROVIDER` | `gemini` | Finance explanation/tool-loop provider; `claude` selects Anthropic |
| `FINANCE_AGENT_BACKGROUND_ENABLED` | Enabled unless exactly `false` | Background finance/analyst work |
| `SKARL_SCHEDULED_JOBS_DISABLED` | Disabled switch is off unless exactly `true` | Stops scheduled reconciliation/finance/analyst work |
| `FINANCE_ANALYST_MAX_RUNS_PER_HOUR` | `30`; bounded to `1000`, zero disables | Separately owned analyst scheduling |
| `FINANCE_ANALYST_MAX_CONCURRENCY` | `2`; bounded to `10`, zero disables | Separately owned analyst scheduling |
| `FINANCE_ANALYST_CLOSE_MINUTES` | `60`; bounded to `1440` | Separately owned analyst close scheduling |
| `NESSIE_ENABLED` | Off unless exactly `true` | Capital One Nessie simulated-bank witness feature |
| `NESSIE_API_KEY` | Unset | Nessie simulated-bank API credential; never proof of fiat settlement |
| `EAS_ATTESTATIONS_ENABLED` | Off unless exactly `true` | Durable EAS attestation scheduler/executor |
| `EAS_ATTESTOR_ADDRESS` | Unset | Managed EAS attestor account binding |
| `EAS_ATTESTOR_POLICY_ID` | Unset | Independent EAS contract-operation policy binding |
| `NODE_ENV` | Set by build/runtime | Development-only UI diagnostics |
| `VERCEL` | Set by hosting provider; only `1` enables trusted forwarded-IP use | Public order ingress rate bucket selection |
| `VERCEL_GIT_COMMIT_SHA` | Unset | Public footer source revision |
| `PAYMENT_NETWORK, SKARL_PAYMENT_NETWORK, SKARL_BUYER_NETWORK` | Unset or exactly `eip155:84532` | Buyer safety assertions; cannot override canonical chain |
| `PAYMENT_CHAIN_ID, SKARL_PAYMENT_CHAIN_ID` | Unset or exactly `84532` | Buyer safety assertions; cannot override canonical chain |
| `CONVEX_DEPLOYMENT` | Unset; explicit target selected by operator/CLI | Convex CLI; local check refuses unknown/remote target without explicit cloud path |
| `CONVEX_DEPLOY_KEY, CONVEX_DEPLOYMENT_TOKEN` | Unset | CLI credentials; guarded local sync refuses remote credentials |
| `CONVEX_SELF_HOSTED_URL, CONVEX_SELF_HOSTED_ADMIN_KEY` | Unset | Self-hosted CLI configuration; local check permits localhost only |
| `CONVEX_AGENT_MODE` | Local check sets `anonymous` | Isolated local Convex check process |

## Web and mobile environment setup

Use the hosting provider's environment settings for the selected web deployment, then build/release it through the normal operator flow. The change does not deploy anything. Keep `SKARL_PAYMENT_ORIGIN` identical in Convex and the web server to preserve existing payment resource identity. Browser connection links use `NEXT_PUBLIC_SKARL_ORIGIN` and `NEXT_PUBLIC_CONVEX_SITE_URL`, so they can differ intentionally from the payment origin.

A local build with privately populated operator origin variables is:

```sh
: "${CONVEX_URL:?choose the deployment URL}"
: "${SKARL_APP_ORIGIN:?choose the public app origin}"
: "${SKARL_AGENT_ORIGIN:?choose the Convex site origin}"
NEXT_PUBLIC_CONVEX_URL="$CONVEX_URL" \
NEXT_PUBLIC_SKARL_ORIGIN="$SKARL_APP_ORIGIN" \
NEXT_PUBLIC_CONVEX_SITE_URL="$SKARL_AGENT_ORIGIN" \
SKARL_PAYMENT_ORIGIN=https://skarl.vercel.app pnpm build
```

Set those same nonsecret values in the web provider. Server credentials such as the payment-service secret remain server-only. `NEXT_PUBLIC_*` values are captured at build time; rebuild after changing them. Expo public values likewise require restarting Expo or rebuilding the app. For an existing locally installed mobile app workspace:

```sh
cd apps/mobile
: "${CONVEX_URL:?choose the deployment URL}"
EXPO_PUBLIC_CONVEX_URL="$CONVEX_URL" bunx expo start --go --lan
```

## Protocol boundaries and honest exceptions

The canonical chain/token definitions in `packages/contracts/src/chain.ts`, ABI/event signatures, USDC decimal precision, JSON Schema bounds, action/status enums and cryptographic lengths are protocol contracts, not deployment preferences. Configure heuristic/resource limits through the modules above; do not change schemas or chain constants through environment overrides. Some algorithms retain structural requirements such as informative hashes and ordered timestamp intervals. Browser detector classes are model metadata; unsupported classes route to advisory `not_applicable`. Next route `maxDuration` exports remain literal platform build constraints.

Explicit synthetic examples live under fixture/test/example paths and never supply a production verifier fallback. `scripts/no-hardcode.mjs`, included in `pnpm check`, scans production paths for task/domain/model literals and known stored-ID patterns, exempting explicit tests, fixtures, docs and config defaults. Its only ownership exception is the existing `claude-sonnet-5-5` literal in `convex/financeAnalystData.ts`: the finance analyst module is separately owned and outside this migration’s edit boundary. Other literals in that file remain checked. Retire the exception when its owner adopts shared model config.

The Python verifier is a schema/scaffold reader and does not perform provider inference, storage, gateway polling or payment. Its `.env.example` entries `SKARL_ASR_MODEL` (example `base.en`), `SKARL_SSCD_MODEL_PATH` (empty), `SKARL_MAX_VIDEO_SECONDS` (example `30`), `SKARL_WORKER_GATEWAY_URL`, `SKARL_WORKER_SERVICE_ID` and `SKARL_WORKER_SERVICE_SECRET` (empty) describe deferred integrations and have no runtime consumer. Gemini entries in that example likewise do not enable Python inference; the live provider configuration belongs on Convex.
