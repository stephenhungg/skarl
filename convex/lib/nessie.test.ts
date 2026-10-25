import { describe, expect, it, vi } from "vitest";
import { BANK_WITNESS_LABEL, compareBankWitness, createNessieClient, nessieAmountAtomic, nessieAmountToken,
  type BankActivity, type BankExpectation } from "./nessie";

// All provider responses are synthetic fixtures. No live credentials or bank calls.
const accountId = "treasury";
const expected: BankExpectation = { intentId: "funding-intent", amountAtomic: "1875000", accountId, kind: "deposit" };
const row: BankActivity = { id: "deposit-1", kind: "deposit", accountId, amountAtomic: "1875000",
  description: "funding-intent", status: "completed" };
const customer = { first_name: "Simulated", last_name: "Treasury",
  address: { street_number: "1", street_name: "Test Street", city: "Test", state: "CA", zip: "00000" } };
function response(body: string, status = 200) { return new Response(body, { status }); }
function mock() { return vi.fn<typeof fetch>(); }

describe("Nessie bank witness (simulated provider responses)", () => {
  it("labels the source explicitly and matches exact intent, amount and account", () => {
    expect(BANK_WITNESS_LABEL).toBe("simulated bank (Capital One Nessie mock)");
    expect(compareBankWitness(expected, [row])).toEqual({ status: "match", activityIds: [row.id] });
    expect(compareBankWitness(expected, [])).toMatchObject({ status: "missing", reason: "bank_record_missing" });
    for (const change of [{ amountAtomic: "1875001" }, { accountId: "foreign" }, { kind: "transfer" as const }, { payeeId: "foreign" }]) {
      expect(compareBankWitness(expected, [{ ...row, ...change }])).toMatchObject({ status: "mismatch" });
    }
    expect(compareBankWitness(expected, [{ ...row, description: "another-intent" }])).toMatchObject({ status: "missing" });
    expect(compareBankWitness(expected, [row, { ...row, id: "duplicate" }])).toMatchObject({ status: "mismatch", reason: "duplicate_bank_records" });
  });
  it("requires outgoing transfer source and intended contributor, and never calls pending settled", () => {
    const transfer: BankActivity = { ...row, kind: "transfer", payeeId: "contributor" };
    const payable: BankExpectation = { ...expected, kind: "transfer", payeeId: "contributor" };
    expect(compareBankWitness(payable, [transfer]).status).toBe("match");
    expect(compareBankWitness(payable, [{ ...transfer, payeeId: "attacker" }]).status).toBe("mismatch");
    expect(compareBankWitness(expected, [{ ...row, status: "pending" }])).toMatchObject({ status: "missing", reason: "bank_record_pending" });
    expect(compareBankWitness(expected, [{ ...row, status: "cancelled" }])).toMatchObject({ status: "mismatch" });
    expect(compareBankWitness(expected, [{ ...row, status: "unknown" }])).toMatchObject({ status: "mismatch" });
  });
  it("keeps six decimal places exact including values exceeding Number precision", () => {
    for (const [amount, token] of [["1", "0.000001"], ["1875000", "1.875000"], ["9007199254740993", "9007199254.740993"],
      ["9223372036854775807", "9223372036854.775807"]]) {
      expect(nessieAmountToken(amount!)).toBe(token);
      expect(nessieAmountAtomic(token!)).toBe(amount);
    }
    expect(nessieAmountAtomic("1e-6")).toBe("1");
    expect(nessieAmountAtomic("1.8750000")).toBe("1875000");
    for (const invalid of ["0", "-1", "01", "1.5", "9223372036854775808"]) expect(() => nessieAmountToken(invalid)).toThrow();
    for (const invalid of ["0", "-1", "1.0000001", "1e-7", "1e999", "1e-999"]) expect(() => nessieAmountAtomic(invalid)).toThrow();
  });
  it("rejects silent HTTP 200 [] keys rather than treating empty GET as authenticated", async () => {
    const fetchImpl = mock().mockImplementation(async () => response("[]"));
    const client = createNessieClient({ apiKey: "invalid-test-key", fetchImpl });
    await expect(client.activity(accountId)).rejects.toThrow("nessie_credentials_unverified");
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(client.verifyAccount(accountId)).rejects.toThrow("nessie_credentials_unverified");
    await expect(client.activity(accountId)).rejects.toThrow("nessie_credentials_unverified");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(client.deposit(accountId, { amountAtomic: "1", description: "intent", transactionDate: "2026-10-25" }))
      .rejects.toThrow("nessie_credentials_unverified");
  });
  // Live Nessie returns 404 "No transfers found" for a verified account with zero transfers; treating it as an
  // outage hid every bank snapshot. Only the transfers listing gets this treatment; a deposits 404 still fails.
  it("treats a transfers-list 404 on a verified account as no transfers, but not a deposits 404", async () => {
    const empty = mock().mockResolvedValueOnce(response('{"_id":"treasury"}'))
      .mockImplementation(async url => String(url).includes("/transfers") ? response('{"message":"No transfers found for this account"}', 404) : response("[]"));
    const client = createNessieClient({ apiKey: "test-key", fetchImpl: empty });
    await client.verifyAccount(accountId);
    expect(await client.activity(accountId)).toEqual([]);
    const missingDeposits = mock().mockResolvedValueOnce(response('{"_id":"treasury"}'))
      .mockImplementation(async url => String(url).includes("/deposits") ? response("{}", 404) : response("[]"));
    const broken = createNessieClient({ apiKey: "test-key", fetchImpl: missingDeposits });
    await broken.verifyAccount(accountId);
    await expect(broken.activity(accountId)).rejects.toThrow("nessie_http_404");
  });
  it("requires the exact known account and clears a prior credential verification on failure", async () => {
    const fetchImpl = mock().mockResolvedValueOnce(response('{"_id":"treasury"}'))
      .mockResolvedValueOnce(response('{"_id":"foreign"}'));
    const client = createNessieClient({ apiKey: "test-key", fetchImpl });
    await client.verifyAccount(accountId);
    await expect(client.verifyAccount(accountId)).rejects.toThrow("nessie_credentials_unverified");
    await expect(client.activity(accountId)).rejects.toThrow("nessie_credentials_unverified");
  });
  it("uses a successful POST customer or account as a credential probe", async () => {
    const fetchImpl = mock().mockImplementation(async () => response('{"code":201,"objectCreated":{"_id":"created"}}', 201));
    const client = createNessieClient({ apiKey: "test-key", fetchImpl });
    expect(await client.createCustomer(customer)).toEqual({ id: "created" });
    expect(await client.createAccount("created", { nickname: "Simulated Treasury", type: "Checking", rewards: 0, balance: 0 }))
      .toEqual({ id: "created" });
    const resumed = createNessieClient({ apiKey: "test-key", fetchImpl });
    expect(await resumed.createAccount("created", { nickname: "Simulated Treasury", type: "Checking", rewards: 0, balance: 0 }))
      .toEqual({ id: "created" });
    expect(await resumed.deposit(accountId, { amountAtomic: "1", description: "intent", transactionDate: "2026-10-25" }))
      .toEqual({ id: "created" });
  });
  it("sends exact unquoted JSON decimal amount tokens and a bounded account path", async () => {
    const fetchImpl = mock().mockResolvedValueOnce(response('{"_id":"treasury"}'))
      .mockImplementation(async () => response('{"objectCreated":{"_id":"created"}}', 201));
    const client = createNessieClient({ apiKey: "test&key", fetchImpl });
    await client.verifyAccount(accountId);
    await client.transfer(accountId, { payeeId: "contributor", amountAtomic: "9007199254740993",
      description: 'intent-"amount":null', transactionDate: "2026-10-25" });
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe("https://prod-api.nessieisreal.com/accounts/treasury/transfers?key=test%26key");
    expect(init?.body).toContain('"amount":9007199254.740993');
    expect(init?.body).toContain('"medium":"balance"');
    expect(JSON.parse(String(init?.body))).toMatchObject({ description: 'intent-"amount":null', payee_id: "contributor" });
    await expect(client.activity("../../customers")).rejects.toThrow("nessie_invalid_id");
  });
  it("parses provider amount numeric tokens losslessly and preserves incoming transfer direction", async () => {
    const fetchImpl = mock().mockResolvedValueOnce(response('{"_id":"treasury"}'))
      .mockResolvedValueOnce(response('[{"_id":"deposit-1","payee_id":"treasury","amount":9007199254.740993,"description":"funding-intent","status":"completed"}]'))
      .mockResolvedValueOnce(response('[{"_id":"transfer-1","payer_id":"external","payee_id":"treasury","amount":1e-6,"description":"incoming","status":"completed"}]'));
    const client = createNessieClient({ apiKey: "test-key", fetchImpl });
    await client.verifyAccount(accountId);
    expect(await client.activity(accountId)).toEqual([
      { ...row, amountAtomic: "9007199254740993" },
      { id: "transfer-1", kind: "transfer", accountId: "external", payeeId: "treasury", amountAtomic: "1", description: "incoming", status: "completed" },
    ]);
  });
  it("fails closed on malformed, foreign-account or submicro bank activity", async () => {
    for (const change of [{ payee_id: "foreign" }, { amount: "1.0000001" }, { status: undefined }, { _id: "../../invalid" }]) {
      const raw = { _id: "deposit-1", payee_id: accountId, amount: "1.875", status: "completed", ...change };
      const fetchImpl = mock().mockResolvedValueOnce(response('{"_id":"treasury"}'))
        .mockResolvedValueOnce(response(JSON.stringify([raw]))).mockResolvedValueOnce(response("[]"));
      const client = createNessieClient({ apiKey: "test-key", fetchImpl });
      await client.verifyAccount(accountId);
      await expect(client.activity(accountId)).rejects.toThrow();
    }
  });
  it("never exposes credentials or provider/network response text", async () => {
    const secret = "private-test-key";
    const absent = createNessieClient({});
    await expect(absent.createCustomer(customer)).rejects.toThrow("nessie_key_not_configured");
    for (const fetchImpl of [mock().mockResolvedValue(response(`secret=${secret}`, 401)),
      mock().mockRejectedValue(new Error(`https://provider?key=${secret}`)),
      mock().mockResolvedValue(response(`invalid-json-${secret}`))]) {
      try { await createNessieClient({ apiKey: secret, fetchImpl }).createCustomer(customer); throw new Error("expected_rejection"); }
      catch (error) { expect(String(error)).not.toContain(secret); expect(String(error)).toContain("nessie_"); }
    }
  });
});
