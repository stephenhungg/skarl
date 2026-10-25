/** Runtime defaults live here; order terms and task specifications live in Convex. */
export function envString(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}
export function envNumber(key: string, fallback: number, minimum = 0): number {
  const raw = process.env[key];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`invalid_config:${key}`);
  return value;
}
// Blank values count as unset: Convex module analysis can expose unset variables as "".
export function envList(key: string, fallback: readonly string[]): string[] {
  const raw = process.env[key]?.trim();
  return raw ? raw.split(",").map((value: string) => value.trim()).filter(Boolean) : [...fallback];
}
export const appOrigin = () => envString("SKARL_APP_ORIGIN", "https://skarl.devshardat.work");
export const paymentOrigin = () => envString("SKARL_PAYMENT_ORIGIN", "https://skarl.vercel.app");
export const agentOrigin = () => envString("SKARL_AGENT_ORIGIN", "https://keen-marmot-986.convex.site");
export const walletOrigins = () => envList("SKARL_WALLET_ORIGINS", [appOrigin(), paymentOrigin()]);
export const demoOrderPublicId = () => envString("SKARL_DEMO_ORDER_PUBLIC_ID", "skarl-red-cup-demo-v2");
export const legacyDemoOrderPublicId = () => envString("SKARL_LEGACY_DEMO_ORDER_PUBLIC_ID", "skarl-red-cup-demo-v1");
export const publicOrderPrefix = () => envString("SKARL_PUBLIC_ORDER_PREFIX", "skarl-outsider-demo-");
export const fixtureOrderPrefixes = () => envList("SKARL_FIXTURE_ORDER_PREFIXES", ["scenario:", publicOrderPrefix(), "skarl-red-cup-demo-sol", legacyDemoOrderPublicId()]);
export const demoOrganizationKey = () => envString("SKARL_DEMO_ORGANIZATION_KEY", "skarl-demo-v1");
export const verifierIdentity = () => envString("SKARL_VERIFIER_IDENTITY", "gemini-verifier");
export const configuredVideoModel = () => envString("GEMINI_VIDEO_MODEL", "gemini-4-argon");
export const configuredFinanceModel = () => envString("GEMINI_FINANCE_MODEL", "gemini-3.8-flash");
export const configuredAudioModel = () => envString("GEMINI_AUDIO_MODEL", "gemini-3.5-transcribe");
export const configuredClaudeModel = () => envString("ANTHROPIC_MODEL", "claude-sonnet-5-5");
export const transcriptionModel = () => envString("GEMINI_TRANSCRIPTION_MODEL", "gemini-3.5-transcribe");
export const evaluationVideoModels = () => {
  // The jury is its own pair (pre-config behaviour); deriving it from GEMINI_VIDEO_MODEL collapsed it to one model.
  const models = envList("GEMINI_EVALUATION_MODELS", ["gemini-4-argon", "gemini-3.8-flash"]);
  if (models.length < 2 || models.length > 16 || new Set(models).size !== models.length || models.some(model => !/^[a-z0-9][a-z0-9._-]{0,80}$/.test(model))) throw new Error("invalid_config:GEMINI_EVALUATION_MODELS");
  return models;
};
export const attestationVideoModels = () => envList("EAS_ALLOWED_VIDEO_MODELS", [...evaluationVideoModels(), "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"]);

/** Numeric policy and resource defaults; invalid environment values fail closed. */
const numericDefaults = {
  FINANCE_AGENT_MIN_CONTEXT_CHARS: { value: 32000, minimum: 1 },
  FINANCE_AGENT_MAX_CONTEXT_CHARS: { value: 100000, minimum: 1 },
  FINANCE_AGENT_SUMMARY_FACT_LIMIT: { value: 18, minimum: 1 },
  FINANCE_AGENT_SUMMARY_FACT_CHARS: { value: 180, minimum: 1 },
  FINANCE_AGENT_WRAPUP_CHARS: { value: 3600, minimum: 1 },
  FINANCE_AGENT_UNKNOWN_RESULT_CHARS: { value: 6000, minimum: 1 },
  FINANCE_AGENT_RESULT_ENVELOPE_CHARS: { value: 1000, minimum: 1 },
  SKARL_FINANCE_TOOL_PAGE_SIZE: { value: 30, minimum: 1 },
  SKARL_FINANCE_PRIOR_NOTE_LIMIT: { value: 12, minimum: 1 },
  SKARL_FINANCE_WALLET_AUDIT_LIMIT: { value: 500, minimum: 1 },
  SKARL_FINANCE_AUDIT_SCAN_LIMIT: { value: 2000, minimum: 1 },
  SKARL_FINANCE_CRON_HISTORY_LIMIT: { value: 20, minimum: 1 },

  FINANCE_AGENT_CONTEXT_CHARS: { value: 80000, minimum: 32000 },
  SKARL_FINANCE_TOOL_READ_LIMIT: { value: 250, minimum: 1 },
  FINANCE_AGENT_DEADLINE_RESERVE_MS: { value: 1500, minimum: 1 },
  FINANCE_AGENT_LOOP_CONTEXT_CHARS: { value: 65000, minimum: 1 },
  FINANCE_AGENT_TOOL_RESULT_CHARS: { value: 12000, minimum: 1 },
  FINANCE_AGENT_DETAILED_RESULT_CHARS: { value: 18000, minimum: 1 },
  SKARL_PUBLIC_CATALOG_LIMIT: { value: 25, minimum: 1 },
  SKARL_COACH_RETRY_COOLDOWN_MS: { value: 60000, minimum: 1 },
  SKARL_COACH_LEASE_MS: { value: 90000, minimum: 1 },
  SKARL_CHAIN_SNAPSHOT_COOLDOWN_MS: { value: 30000, minimum: 1 },
  SKARL_CHAIN_SNAPSHOT_FRESH_MS: { value: 120000, minimum: 1 },
  SKARL_AGENT_CHAT_DEADLINE_MS: { value: 120000, minimum: 1 },
  SKARL_AGENT_CHAT_LEASE_MS: { value: 180000, minimum: 1 },
  SKARL_FINANCE_AGENT_LEASE_MS: { value: 180000, minimum: 1 },
  SKARL_FINANCE_AGENT_MAX_ALLOWED_TOOL_CALLS: { value: 24, minimum: 1 },
  FINANCE_AGENT_MAX_BATCH_SIZE: { value: 20, minimum: 1 },
  SKARL_FINANCE_TICK_LEASE_MS: { value: 540000, minimum: 1 },
  SKARL_RECONCILIATION_TICK_LEASE_MS: { value: 110000, minimum: 1 },
  SKARL_BANK_TICK_LEASE_MS: { value: 90000, minimum: 1 },
  SKARL_VERIFICATION_LEASE_MS: { value: 300000, minimum: 1 },
  SKARL_HEALTH_FINANCE_FRESH_MS: { value: 1500000, minimum: 1 },
  SKARL_HEALTH_PROBE_FRESH_MS: { value: 300000, minimum: 1 },
  SKARL_HEALTH_INTEGRATION_FRESH_MS: { value: 86400000, minimum: 1 },
  SKARL_HEALTH_JIRA_FRESH_MS: { value: 900000, minimum: 1 },

  SKARL_LIVENESS_CHALLENGE_TTL_MS: { value: 120_000, minimum: 1 },
  SKARL_LIVENESS_WORD_COUNT: { value: 3, minimum: 1 },
  FINANCE_AGENT_MAX_TOOL_CALLS: { value: 24, minimum: 1 },
  ANTHROPIC_REQUEST_TIMEOUT_MS: { value: 30_000, minimum: 1 },
  GEMINI_REQUEST_TIMEOUT_MS: { value: 30_000, minimum: 1 },
  SKARL_ATTEMPTS_PER_ORDER: { value: 4, minimum: 1 },
  SKARL_BANK_FRESH_MS: { value: 5 * 60_000, minimum: 1 },
  SKARL_BUCKET_MS: { value: 5 * 60_000, minimum: 1 },
  SKARL_CDPSQL_MAX_ROWS: { value: 10_000, minimum: 1 },
  SKARL_DERIVEDANNOTATIONS_MAX_ANNOTATION_BYTES: { value: 5 * 1024 * 1024, minimum: 1 },
  SKARL_DERIVEDANNOTATIONS_MAX_ANNOTATION_FRAMES: { value: 2000, minimum: 1 },
  SKARL_DISCOVERY_RATE_CAPACITY: { value: 600, minimum: 1 },
  SKARL_DISCOVERY_RATE_REFILL: { value: 600, minimum: 1 },
  SKARL_DUPLICATE_CANDIDATE_LIMIT: { value: 200, minimum: 1 },
  SKARL_DUPLICATE_MAX_FRAME_DISTANCE: { value: 10, minimum: 0 },
  SKARL_DUPLICATE_MAX_MEAN_DISTANCE: { value: 6, minimum: 0 },
  SKARL_FINANCE_AGENT_DEADLINE_MS: { value: 120_000, minimum: 1 },
  SKARL_FINANCE_INTERVAL_MS: { value: 600_000, minimum: 1 },
  SKARL_IDEMPOTENCY_RETRY_MS: { value: 23 * 60 * 60_000, minimum: 1 },
  SKARL_JIRA_RATE_CAPACITY: { value: 120, minimum: 1 },
  SKARL_JIRA_RATE_REFILL: { value: 120, minimum: 1 },
  SKARL_LEASE_MS: { value: 3 * 60_000, minimum: 1 },
  SKARL_MCP_RATE_CAPACITY: { value: 240, minimum: 1 },
  SKARL_MCP_RATE_REFILL: { value: 240, minimum: 1 },
  SKARL_MEDIA_FRAME_SAMPLES: { value: 6, minimum: 1 },
  SKARL_MEDIA_MAX_AUDIO_BYTES: { value: 2 * 1024 * 1024, minimum: 1 },
  SKARL_MEDIA_MAX_BINARY_BYTES: { value: 100 * 1024 * 1024, minimum: 1 },
  SKARL_MEDIA_MAX_DURATION_MS: { value: 30_000, minimum: 1 },
  SKARL_MEDIA_MAX_INPUT_BYTES: { value: 25 * 1024 * 1024, minimum: 1 },
  SKARL_MEDIA_MAX_JPEG_BYTES: { value: 100 * 1024, minimum: 1 },
  SKARL_MEDIA_MAX_VIDEO_BYTES: { value: 12 * 1024 * 1024, minimum: 1 },
  SKARL_MEDIA_VISUAL_SAMPLES: { value: 12, minimum: 1 },
  SKARL_NESSIE_MAX_ROWS: { value: 5_000, minimum: 1 },
  SKARL_ORDERS_PER_TICK: { value: 3, minimum: 1 },
  SKARL_PAYMENT_APPROVAL_TTL_MS: { value: 3_600_000, minimum: 1 },
  SKARL_QUALITY_REVIEW_SCORE_CAP: { value: 49, minimum: 0 },
  SKARL_QUALITY_SEGMENT_PADDING_MS: { value: 500, minimum: 0 },
  SKARL_RECONCILIATION_INTERVAL_MS: { value: 120_000, minimum: 1 },
  SKARL_RETRY_MS: { value: 2 * 60_000, minimum: 1 },
  SKARL_SENSORTRACE_MAX_SENSOR_TRACE_BYTES: { value: 2 * 1024 * 1024, minimum: 1 },
  SKARL_SENSORTRACE_STEADY_GYRO_RAD_PER_SEC: { value: 0.15, minimum: 0 },
  SKARL_WALLET_CHALLENGE_TTL_MS: { value: 300_000, minimum: 1 },
  VERIFIER_MAX_ACTIONS: { value: 64, minimum: 1 },
  VERIFIER_MAX_RAW_LENGTH: { value: 64_000, minimum: 1 },
  VERIFIER_MAX_SEGMENTS: { value: 256, minimum: 1 },
  VERIFIER_MAX_TEXT_LENGTH: { value: 16_000, minimum: 1 },
  VERIFIER_PRONOUN_WINDOW_MS: { value: 4_000, minimum: 1 },
  VERIFIER_TEMPORAL_TOLERANCE_MS: { value: 2_000, minimum: 1 },
} as const;
export function configNumber(key: keyof typeof numericDefaults): number {
  const setting = numericDefaults[key];
  const value = envNumber(key, setting.value, setting.minimum);
  if (key !== "SKARL_SENSORTRACE_STEADY_GYRO_RAD_PER_SEC" && !Number.isSafeInteger(value)) throw new Error(`invalid_config:${key}`);
  return value;
}

export const approvedPipelinePattern = () => envString("EAS_ALLOWED_PIPELINE_PATTERN", "^(task-evidence-2\\.0|red-cup-evidence-[0-9]+\\.[0-9]+(?:\\.[0-9]+)?)$");

const DEFAULT_LIVENESS_WORDS = [
  "apple", "apron", "arrow", "bacon", "badge", "basket", "beach", "bean",
  "bear", "bell", "berry", "bird", "blanket", "boat", "bone", "book",
  "boot", "bottle", "branch", "bread", "bridge", "broom", "bubble", "button",
  "cabin", "candle", "carrot", "castle", "chair", "cheese", "cherry", "chicken",
  "circle", "cloud", "cookie", "corn", "cotton", "crayon", "crown", "daisy",
  "desert", "dinner", "dolphin", "donkey", "dragon", "dream", "drum", "duck",
  "eagle", "earth", "elbow", "engine", "feather", "fence", "field", "finger",
  "flower", "forest", "fork", "fox", "frog", "garden", "giant", "glove",
  "goat", "grape", "grass", "guitar", "hammer", "hat", "honey", "horse",
  "island", "jacket", "jelly", "juice", "key", "kite", "kitten", "ladder",
  "lake", "lamp", "leaf", "lemon", "letter", "lion", "lizard", "moon",
  "mountain", "mouse", "muffin", "nest", "ocean", "onion", "orange", "otter",
  "panda", "paper", "peach", "peanut", "pencil", "pepper", "piano", "pillow",
  "planet", "pocket", "potato", "pumpkin", "rabbit", "rainbow", "river", "robot",
  "rocket", "saddle", "salad", "sand", "scarf", "shell", "sheep", "shoe",
  "snow", "soap", "spoon", "star", "stone", "tiger", "train", "tree",
] as const;
export const livenessWords = () => envList("SKARL_LIVENESS_WORDS", DEFAULT_LIVENESS_WORDS);

export const financeAgentMaxBatchAtomic = () => envString("FINANCE_AGENT_MAX_BATCH_ATOMIC", "10000000");
export const attestorName = () => envString("EAS_ATTESTOR_NAME", "skarl-attestor");
export const easAddress = () => envString("EAS_ADDRESS", "0x4200000000000000000000000000000000000021") as `0x${string}`;
export const schemaRegistryAddress = () => envString("EAS_SCHEMA_REGISTRY_ADDRESS", "0x4200000000000000000000000000000000000020") as `0x${string}`;

export const taxReportingThreshold = () => envString("SKARL_TAX_REPORTING_THRESHOLD_MICRO_USD", "600000000");
export const baseRpcUrl = () => envString("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org");

const DEFAULT_QUALITY_WEIGHTS = { juryAgreement: 25, allCriteriaSupported: 25, duplicateClear: 20,
  livenessPassed: 15, sensorSteadiness: 5, attestationPresent: 10 } as const;
export function qualityWeights(): Record<keyof typeof DEFAULT_QUALITY_WEIGHTS, number> {
  const raw = process.env.SKARL_QUALITY_WEIGHTS;
  const parsed: unknown = raw ? JSON.parse(raw) : DEFAULT_QUALITY_WEIGHTS;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    Object.keys(parsed).length !== Object.keys(DEFAULT_QUALITY_WEIGHTS).length ||
    Object.keys(DEFAULT_QUALITY_WEIGHTS).some(key => !Object.hasOwn(parsed, key)) ||
    Object.values(parsed).some(value => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) ||
    Object.values(parsed).reduce((sum: number, value) => sum + Number(value), 0) !== 100) throw new Error("invalid_config:SKARL_QUALITY_WEIGHTS");
  return parsed as Record<keyof typeof DEFAULT_QUALITY_WEIGHTS, number>;
}

export const geminiEndpoint = () => envString("GEMINI_API_URL", "https://generativelanguage.googleapis.com/v1beta/interactions");
export const anthropicEndpoint = () => envString("ANTHROPIC_BASE_URL", "https://api.anthropic.com");
export const cdpSqlEndpoint = () => envString("CDP_SQL_API_URL", "https://api.cdp.coinbase.com/platform/v2/data/query/run");
export const nessieEndpoint = () => envString("NESSIE_API_URL", "https://prod-api.nessieisreal.com");

/** Detector label vocabulary is model metadata, independent of any order. */
export const detectorClasses = () => envList("SKARL_DETECTOR_CLASSES", ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic_light",
    "fire_hydrant", "stop_sign", "parking_meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear",
    "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports_ball",
    "kite", "baseball_bat", "baseball_glove", "skateboard", "surfboard", "tennis_racket", "bottle", "wine_glass", "cup", "fork",
    "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot_dog", "pizza", "donut", "cake",
    "chair", "couch", "potted_plant", "bed", "dining_table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell_phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy_bear", "hair_drier", "toothbrush"]);

export const walletMcpOrderKey = () => envString("SKARL_WALLET_MCP_ORDER_KEY", "wallet-mcp-agent-order-v1");
export const walletMcpRequestId = () => envString("SKARL_WALLET_MCP_REQUEST_ID", "00000000-0000-4000-8000-000000000001");
