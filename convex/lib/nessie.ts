/** Nessie is a banking simulator. None of these records prove a fiat movement. */
export const BANK_WITNESS_LABEL = "simulated bank (Capital One Nessie mock)";
const BASE_URL = "https://prod-api.nessieisreal.com";
const MAX_ATOMIC = (1n << 63n) - 1n;
const MAX_ROWS = 5_000;
export type BankActivity = {
  id: string;
  kind: "deposit" | "transfer";
  /** The receiving account for a deposit; the sending account for a transfer. */
  accountId: string;
  payeeId?: string;
  amountAtomic: string;
  description: string;
  status: string;
};
export type BankExpectation = {
  intentId: string;
  amountAtomic: string;
  accountId: string;
  kind: "deposit" | "transfer";
  payeeId?: string;
};
export type BankComparison = {
  status: "match" | "missing" | "mismatch";
  reason?: string;
  activityIds: string[];
};
export type NessieCustomer = {
  first_name: string;
  last_name: string;
  address: { street_number: string; street_name: string; city: string; state: string; zip: string };
};
export type NessieAccount = { nickname: string; type: "Checking"; rewards: 0; balance: 0 };
export type NessiePayment = { amountAtomic: string; description: string; transactionDate: string };

function atomic(value: string): bigint {
  if (!/^(0|[1-9]\d{0,18})$/.test(value)) throw new Error("nessie_invalid_amount");
  const amount = BigInt(value);
  if (amount <= 0n || amount > MAX_ATOMIC) throw new Error("nessie_invalid_amount");
  return amount;
}
/** Exact decimal JSON token, without converting money through Number. */
export function nessieAmountToken(value: string): string {
  const amount = atomic(value);
  return `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, "0")}`;
}
export function nessieAmountAtomic(value: string): string {
  const match = /^(0|[1-9]\d{0,30})(?:\.(\d{1,30}))?(?:[eE]([+-]?\d{1,3}))?$/.exec(value);
  if (!match) throw new Error("nessie_invalid_amount");
  const fraction = match[2] ?? "";
  const shift = 6n + BigInt(match[3] ?? "0") - BigInt(fraction.length);
  if (shift > 30n || shift < -60n) throw new Error("nessie_invalid_amount");
  const digits = BigInt(match[1]! + fraction);
  const denominator = shift < 0n ? 10n ** -shift : 1n;
  if (digits % denominator !== 0n) throw new Error("nessie_submicro_amount");
  const amount = shift < 0n ? digits / denominator : digits * 10n ** shift;
  return atomic(amount.toString()).toString();
}
/** Quote JSON numeric tokens before parsing: six-decimal money never becomes a float. */
function parseExactJson(text: string): unknown {
  if (text.length > 4_000_000) throw new Error("nessie_response_too_large");
  const quoted = text.replace(/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    token => token.startsWith('"') ? token : JSON.stringify(token));
  return JSON.parse(quoted);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("nessie_invalid_response");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 500) throw new Error("nessie_invalid_response");
  return value;
}
function id(value: unknown): string {
  const result = string(value);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(result)) throw new Error("nessie_invalid_id");
  return result;
}
function created(payload: unknown): { id: string } {
  const response = object(payload);
  return { id: id(object(response.objectCreated)._id) };
}
function paymentBody(input: NessiePayment, extra: Record<string, string> = {}): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate) || !input.description || input.description.length > 200) {
    throw new Error("nessie_invalid_payment");
  }
  const body = JSON.stringify({ medium: "balance", transaction_date: input.transactionDate,
    description: input.description, ...extra });
  return `${body.slice(0, -1)},"amount":${nessieAmountToken(input.amountAtomic)}}`;
}
function activityRows(payload: unknown, accountId: string, kind: BankActivity["kind"]): BankActivity[] {
  if (!Array.isArray(payload) || payload.length > MAX_ROWS) throw new Error("nessie_incomplete_activity");
  return payload.map(value => {
    const row = object(value);
    const source = kind === "deposit" ? id(row.payee_id) : id(row.payer_id);
    const payeeId = kind === "transfer" ? id(row.payee_id) : undefined;
    // Incoming transfers are returned by some Nessie implementations. Preserve
    // their real sender so they cannot masquerade as an outgoing off-ramp.
    if (source !== accountId && payeeId !== accountId) throw new Error("nessie_activity_scope_mismatch");
    return { id: id(row._id), kind, accountId: source, ...(payeeId ? { payeeId } : {}),
      amountAtomic: nessieAmountAtomic(string(row.amount)),
      description: typeof row.description === "string" ? row.description : "", status: string(row.status) };
  });
}

/** Create once per action. A GET [] is never proof that the API key is valid. */
export function createNessieClient(options: { apiKey?: string; fetchImpl?: typeof fetch }) {
  let authenticated = false;
  async function request(path: string, method: "GET" | "POST", body?: string): Promise<unknown> {
    if (!options.apiKey?.trim()) throw new Error("nessie_key_not_configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await (options.fetchImpl ?? fetch)(`${BASE_URL}${path}?key=${encodeURIComponent(options.apiKey)}`, {
        method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body }), signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "nessie_unauthorized" : `nessie_http_${response.status}`);
      return parseExactJson(await response.text());
    } catch (error) {
      // Never pass through network errors/provider bodies: the URL includes a secret.
      if (error instanceof Error && /^nessie_(unauthorized|http_\d{3}|response_too_large)$/.test(error.message)) throw error;
      throw new Error(controller.signal.aborted ? "nessie_timeout" : "nessie_request_or_response_failed");
    } finally { clearTimeout(timer); }
  }
  function verified() {
    if (!authenticated) throw new Error("nessie_credentials_unverified");
  }
  return {
    async verifyAccount(accountId: string): Promise<void> {
      authenticated = false;
      const payload = await request(`/accounts/${id(accountId)}`, "GET");
      // A bad key may produce HTTP 200 with []; require the known account binding.
      if (!payload || Array.isArray(payload) || object(payload)._id !== accountId) throw new Error("nessie_credentials_unverified");
      authenticated = true;
    },
    async createCustomer(customer: NessieCustomer): Promise<{ id: string }> {
      authenticated = false;
      const result = created(await request("/customers", "POST", JSON.stringify(customer)));
      authenticated = true;
      return result;
    },
    async createAccount(customerId: string, account: NessieAccount): Promise<{ id: string }> {
      authenticated = false;
      // Bootstrap only an empty account. No inferred balances or funding authority.
      if (account.type !== "Checking" || account.balance !== 0 || account.rewards !== 0) throw new Error("nessie_invalid_account");
      const result = created(await request(`/customers/${id(customerId)}/accounts`, "POST", JSON.stringify(account)));
      authenticated = true;
      return result;
    },
    async deposit(accountId: string, payment: NessiePayment): Promise<{ id: string }> {
      verified();
      return created(await request(`/accounts/${id(accountId)}/deposits`, "POST", paymentBody(payment)));
    },
    async transfer(accountId: string, payment: NessiePayment & { payeeId: string }): Promise<{ id: string }> {
      verified();
      return created(await request(`/accounts/${id(accountId)}/transfers`, "POST", paymentBody(payment, { payee_id: id(payment.payeeId) })));
    },
    async activity(accountId: string): Promise<BankActivity[]> {
      verified();
      const account = id(accountId);
      const [deposits, transfers] = await Promise.all([
        request(`/accounts/${account}/deposits`, "GET"), request(`/accounts/${account}/transfers`, "GET"),
      ]);
      return [...activityRows(deposits, account, "deposit"), ...activityRows(transfers, account, "transfer")];
    },
  };
}

/** Advisory reconciliation only. Neither this result nor Nessie can approve money. */
export function compareBankWitness(expected: BankExpectation, activity: readonly BankActivity[]): BankComparison {
  atomic(expected.amountAtomic);
  const rows = activity.filter(row => row.description === expected.intentId);
  const activityIds = rows.map(row => row.id);
  if (rows.length === 0) return { status: "missing", reason: "bank_record_missing", activityIds };
  if (rows.length !== 1) return { status: "mismatch", reason: "duplicate_bank_records", activityIds };
  const row = rows[0]!;
  if (row.kind !== expected.kind || row.accountId !== expected.accountId || row.payeeId !== expected.payeeId || row.amountAtomic !== expected.amountAtomic) {
    return { status: "mismatch", reason: "bank_binding_or_amount_mismatch", activityIds };
  }
  if (row.status === "pending") return { status: "missing", reason: "bank_record_pending", activityIds };
  if (row.status !== "completed") return { status: "mismatch", reason: "bank_record_not_completed", activityIds };
  return { status: "match", activityIds };
}
