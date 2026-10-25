import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vWorkflowId } from "@convex-dev/workflow";
import {
  actor,
  amountAtomic,
  attemptStatus,
  completedInferenceOutcome,
  count,
  evmAddress,
  fundingStatus,
  journalSide,
  ledgerAccount,
  membershipRole,
  network,
  orderStatus,
  payableStatus,
  payoutStatus,
  reviewOnlyOutcome,
  submissionStatus,
  tokenIdentifier,
  usdcToken,
} from "./validators";

const tenant = { organizationId: v.id("organizations") };
const asset = { network, tokenAddress: usdcToken };

// Demo finance mutations enforce atomic posting and role checks; remaining tables are design scaffolding.
// Indexes below are lookup indexes, NOT unique constraints. Future mutations
// must perform idempotency reads and dependent writes in one transaction.
// Identities are stored as Convex `tokenIdentifier` (issuer + subject) so that
// comparisons such as self-approval checks cannot confuse two issuers.

const analysisContext = {
  ...tenant,
  jobId: v.id("jobs"),
  submissionId: v.id("submissions"),
  taskVersionId: v.id("rubricVersions"),
  sourceHash: v.string(),
  pipelineVersion: v.string(),
  leaseGeneration: v.number(),
  summary: v.string(),
  reportStorageId: v.id("_storage"),
  reportHash: v.string(),
  evidenceAssetIds: v.array(v.id("mediaAssets")),
  completedAt: v.number(),
  reportJson: v.optional(v.string()),
  observationsJson: v.optional(v.string()),
  processingElapsedMs: v.optional(v.number()),
  perceptualHashSource: v.optional(v.union(v.literal("serverComputed"), v.literal("clientReported"))),
};
export default defineSchema({
  financeAgentRuns: defineTable({
    ...tenant, orderId: v.id("orders"), requestId: v.string(), prompt: v.string(),
    requesterTokenIdentifier: tokenIdentifier, model: v.string(), maxToolCalls: v.number(),
    maxBatchAtomic: amountAtomic, proposedAtomic: amountAtomic, reservedPayableIds: v.array(v.id("payables")),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed"), v.literal("capped")),
    transcriptJson: v.string(), explanation: v.optional(v.string()), failureCode: v.optional(v.string()),
    startedAt: v.number(), completedAt: v.optional(v.number()),
  }).index("by_request", ["organizationId", "requestId"]).index("by_order", ["orderId"]),
  organizations: defineTable({
    name: v.string(),
    demoKey: v.optional(v.string()),
    createdByTokenIdentifier: tokenIdentifier,
    status: v.union(v.literal("active"), v.literal("disabled")),
  }).index("by_demo_key", ["demoKey"]),

  memberships: defineTable({
    ...tenant,
    issuer: v.string(),
    subject: v.string(),
    tokenIdentifier,
    // Roles are granted by an existing controller (or seeded by an operator),
    // never self-assigned. Provisioning must reject contributor + controller
    // on one membership so payout requester and approver stay separate.
    roles: v.array(membershipRole),
    grantedByTokenIdentifier: tokenIdentifier,
    status: v.union(v.literal("active"), v.literal("revoked")),
    // Written only by a dedicated wallet-verification mutation after it checks
    // an EIP-191 (SIWE) signature over a server-issued nonce. Payables copy the
    // address from a verified record.
    walletAddress: v.optional(evmAddress),
    walletVerification: v.optional(
      v.object({
        siweMessageHash: v.string(),
        nonce: v.string(),
        signature: v.string(),
        chainId: v.number(),
        verifiedAt: v.number(),
      }),
    ),
  })
    .index("by_org_identity", ["organizationId", "issuer", "subject"])
    .index("by_identity", ["issuer", "subject"])
    .index("by_token_identifier", ["tokenIdentifier"]),

  orders: defineTable({
    ...tenant,
    ...asset,
    publicId: v.string(),
    buyerTokenIdentifier: tokenIdentifier,
    buyerWalletAddress: evmAddress,
    title: v.string(),
    status: orderStatus,
    taskVersionId: v.optional(v.id("rubricVersions")),
    quantityRequested: count,
    pricePerSampleAtomic: amountAtomic,
    contributorRateAtomic: amountAtomic,
    // Must equal quantityRequested * pricePerSampleAtomic; computed on write.
    budgetAtomic: amountAtomic,
    acceptedCount: count,
    deadlineAt: v.number(),
    termsHash: v.string(),
    updatedAt: v.number(),
  })
    .index("by_public_id", ["publicId"])
    .index("by_org_status", ["organizationId", "status"])
    .index("by_org_buyer", ["organizationId", "buyerTokenIdentifier"]),

  rubricVersions: defineTable({
    ...tenant,
    orderId: v.id("orders"),
    version: v.number(),
    taskPrompt: v.string(),
    criteria: v.array(
      v.object({
        criterionId: v.string(),
        description: v.string(),
        modality: v.union(
          v.literal("visual"),
          v.literal("audio"),
          v.literal("cross_modal"),
          v.literal("temporal"),
        ),
      }),
    ),
    contentHash: v.string(),
    createdByTokenIdentifier: tokenIdentifier,
    frozenAt: v.optional(v.number()),
  }).index("by_order_version", ["orderId", "version"]),

  submissions: defineTable({
    ...tenant,
    orderId: v.id("orders"),
    taskVersionId: v.id("rubricVersions"),
    contributorTokenIdentifier: tokenIdentifier,
    status: submissionStatus,
    clientRequestId: v.string(),
    originalAssetId: v.optional(v.id("mediaAssets")),
    consentRecordId: v.optional(v.id("consentRecords")),
    expectedSourceHash: v.optional(v.string()),
    sourceHash: v.optional(v.string()),
    perceptualHash: v.optional(v.string()),
    perceptualHashSource: v.optional(v.union(v.literal("serverComputed"), v.literal("clientReported"))),
    frameDHashes: v.optional(v.array(v.object({ timestampMs: v.number(), hash: v.string() }))),
    clientFrameDHashes: v.optional(v.array(v.object({ timestampMs: v.number(), hash: v.string() }))),
    verificationOnly: v.optional(v.boolean()),
    evalRunId: v.optional(v.string()),
    currentAnalysisId: v.optional(v.id("analysisResults")),
    currentDecisionId: v.optional(v.id("reviewDecisions")),
    supersedesSubmissionId: v.optional(v.id("submissions")),
    updatedAt: v.number(),
  })
    .index("by_order_status", ["orderId", "status"])
    .index("by_eval_run", ["organizationId", "evalRunId"])
    .index("by_org_status", ["organizationId", "status"])
    .index("by_contributor", ["organizationId", "contributorTokenIdentifier"])
    // Scoped to the contributor so one user cannot claim another's request ID.
    .index("by_request", [
      "organizationId",
      "contributorTokenIdentifier",
      "clientRequestId",
    ])
    .index("by_source_hash", ["organizationId", "sourceHash"])
    .index("by_perceptual_hash", ["organizationId", "perceptualHash"]),

  consentRecords: defineTable({
    ...tenant,
    submissionId: v.id("submissions"),
    contributorTokenIdentifier: tokenIdentifier,
    licenseVersion: v.string(),
    licenseHash: v.string(),
    scope: v.string(),
    acknowledgedAt: v.number(),
    receiptHash: v.string(),
  }).index("by_submission", ["submissionId"]),

  mediaAssets: defineTable({
    ...tenant,
    submissionId: v.id("submissions"),
    jobId: v.optional(v.id("jobs")),
    storageId: v.id("_storage"),
    purpose: v.union(
      v.literal("original"),
      v.literal("normalized_video"),
      v.literal("extracted_audio"),
      v.literal("evidence_frame"),
      v.literal("manifest"),
      v.literal("embeddings"),
    ),
    status: v.union(
      v.literal("uploaded"),
      v.literal("verified"),
      v.literal("quarantined"),
    ),
    contentHash: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    durationMs: v.optional(v.number()),
    sourceTimestampMs: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  })
    .index("by_submission_purpose", ["submissionId", "purpose"])
    .index("by_storage_id", ["storageId"])
    .index("by_content_hash", ["organizationId", "contentHash"]),

  jobs: defineTable({
    ...tenant,
    submissionId: v.id("submissions"),
    taskVersionId: v.id("rubricVersions"),
    sourceHash: v.string(),
    pipelineVersion: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("leased"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    availableAt: v.number(),
    attempt: v.number(),
    maxAttempts: v.number(),
    leaseGeneration: v.number(),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    lastErrorCode: v.optional(v.string()),
  })
    .index("by_status_available", ["status", "availableAt"])
    .index("by_status_lease_expiry", ["status", "leaseExpiresAt"])
    .index("by_logical_job", [
      "submissionId",
      "taskVersionId",
      "pipelineVersion",
      "sourceHash",
    ]),

  analysisResults: defineTable(
    v.union(
      v.object({ ...analysisContext, ...completedInferenceOutcome }),
      v.object({ ...analysisContext, ...reviewOnlyOutcome }),
    ),
  )
    .index("by_job_generation", ["jobId", "leaseGeneration"])
    .index("by_submission", ["submissionId"]),

  reviewDecisions: defineTable({
    ...tenant,
    submissionId: v.id("submissions"),
    analysisResultId: v.optional(v.id("analysisResults")),
    taskVersionId: v.id("rubricVersions"),
    decisionKey: v.string(),
    reasonCode: v.optional(v.string()),
    note: v.optional(v.string()),
    decision: v.union(
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("request_correction"),
    ),
    reviewerTokenIdentifier: tokenIdentifier,
    reason: v.string(),
    evidenceHash: v.string(),
    decidedAt: v.number(),
  })
    .index("by_decision_key", ["organizationId", "decisionKey"])
    .index("by_submission", ["submissionId"]),

  deliveries: defineTable({
    ...tenant,
    orderId: v.id("orders"),
    submissionId: v.id("submissions"),
    decisionId: v.id("reviewDecisions"),
    manifestStorageId: v.optional(v.id("_storage")),
    // Atomically available licensed manifest; originals remain behind authorized access.
    manifest: v.optional(v.object({
      schemaVersion: v.literal("1.0"),
      originalAssetId: v.id("mediaAssets"),
      sourceHash: v.string(),
      taskVersionId: v.id("rubricVersions"),
      consentRecordId: v.id("consentRecords"),
      licenseVersion: v.string(),
      decisionId: v.id("reviewDecisions"),
      analysisResultId: v.optional(v.id("analysisResults")),
    })),
    manifestHash: v.string(),
    termsHash: v.string(),
    eventKey: v.string(),
    publishedAt: v.number(),
  })
    .index("by_event_key", ["organizationId", "eventKey"])
    .index("by_order", ["orderId"])
    .index("by_submission", ["submissionId"]),

  payables: defineTable({
    ...tenant,
    ...asset,
    orderId: v.id("orders"),
    submissionId: v.id("submissions"),
    decisionId: v.id("reviewDecisions"),
    contributorTokenIdentifier: tokenIdentifier,
    recipientAddress: evmAddress,
    amountAtomic,
    sourceEventKey: v.string(),
    status: payableStatus,
    createdAt: v.number(),
  })
    .index("by_source_event", ["organizationId", "sourceEventKey"])
    .index("by_order", ["orderId"])
    .index("by_org_status", ["organizationId", "status"]),

  // Funding keeps its existing shape; outgoing proposals are a discriminated
  // variant linked 1:1 to paymentCommands for independent approval/dispatch.
  paymentIntents: defineTable(v.union(
    v.object({
      ...tenant, ...asset,
      kind: v.optional(v.literal("funding")),
      refundPaymentCommandId: v.optional(v.id("paymentCommands")),
      orderId: v.id("orders"),
      intentId: v.string(),
      buyerWalletAddress: evmAddress,
      recipientAddress: evmAddress,
      amountAtomic,
      termsHash: v.string(),
      resourcePath: v.string(),
      x402Version: v.literal(2),
      paymentIdentifier: v.string(),
      expiresAt: v.number(),
      status: fundingStatus,
      updatedAt: v.number(),
    }),
    v.object({
      ...tenant, ...asset,
      kind: v.literal("contributor_payout"),
      orderId: v.id("orders"),
      intentId: v.string(),
      payableId: v.id("payables"),
      paymentCommandId: v.id("paymentCommands"),
      approvalWorkflowId: v.optional(vWorkflowId),
      requesterTokenIdentifier: tokenIdentifier,
      recipientAddress: evmAddress,
      amountAtomic,
      bindingHash: v.string(),
      sourceVersion: v.string(),
      expiresAt: v.number(),
      status: payoutStatus,
      updatedAt: v.number(),
    }),
  ))
    .index("by_intent_id", ["intentId"])
    .index("by_payment_identifier", ["organizationId", "paymentIdentifier"])
    .index("by_payable", ["payableId"])
    .index("by_order", ["orderId"]),

  approvals: defineTable({
    ...tenant,
    paymentCommandId: v.id("paymentCommands"),
    requestedBy: actor,
    // Must differ from requestedBy.identity (both are tokenIdentifiers).
    approverTokenIdentifier: tokenIdentifier,
    bindingHash: v.string(),
    status: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("revoked"),
      v.literal("expired"),
      v.literal("invalidated"),
    ),
    reason: v.string(),
    decidedAt: v.number(),
    expiresAt: v.number(),
  }).index("by_command", ["paymentCommandId"]),

  paymentCommands: defineTable({
    ...tenant,
    ...asset,
    orderId: v.id("orders"),
    payableId: v.optional(v.id("payables")),
    commandId: v.string(),
    kind: v.union(v.literal("contributor_payout"), v.literal("buyer_refund")),
    requestedBy: actor,
    requesterTokenIdentifier: tokenIdentifier,
    recipientAddress: evmAddress,
    amountAtomic,
    bindingHash: v.string(),
    sourceVersion: v.string(),
    status: payoutStatus,
    approvalId: v.optional(v.id("approvals")),
    attemptCount: v.number(),
    leaseGeneration: v.number(),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    lastErrorCode: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_command_id", ["commandId"])
    .index("by_payable", ["payableId"])
    // Refunds have no payable; this finds an existing refund for an order.
    .index("by_order_kind", ["orderId", "kind"])
    .index("by_org_status", ["organizationId", "status"]),

  paymentAttempts: defineTable({
    ...tenant,
    ...asset,
    paymentIntentId: v.optional(v.id("paymentIntents")),
    paymentCommandId: v.optional(v.id("paymentCommands")),
    attemptId: v.string(),
    attempt: v.number(),
    amountAtomic,
    txHash: v.optional(v.string()),
    // x402 `exact` funding on EVM is an EIP-3009 transferWithAuthorization.
    // Claim (payer, nonce) before settlement so one authorization cannot
    // fund two orders.
    payerAddress: v.optional(evmAddress),
    authorizationNonce: v.optional(v.string()),
    status: attemptStatus,
    lastErrorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_attempt_id", ["attemptId"])
    .index("by_command", ["paymentCommandId"])
    .index("by_intent", ["paymentIntentId"])
    .index("by_tx_hash", ["network", "txHash"])
    .index("by_authorization_nonce", ["network", "payerAddress", "authorizationNonce"]),

  // One row per ERC-20 Transfer log. A transaction can emit several transfers,
  // so identity is (network, txHash, logIndex), never the transaction alone.
  chainObservations: defineTable({
    ...tenant,
    ...asset,
    paymentAttemptId: v.id("paymentAttempts"),
    txHash: v.string(),
    logIndex: v.number(),
    blockNumber: v.int64(),
    blockHash: v.string(),
    fromAddress: evmAddress,
    toAddress: evmAddress,
    amountAtomic,
    confirmations: v.number(),
    succeeded: v.boolean(),
    observedAt: v.number(),
  })
    .index("by_transfer", ["network", "txHash", "logIndex"])
    .index("by_attempt", ["paymentAttemptId"]),

  journalEntries: defineTable({
    ...tenant,
    ...asset,
    orderId: v.id("orders"),
    eventKey: v.string(),
    kind: v.union(
      v.literal("funding"),
      v.literal("fulfillment"),
      v.literal("payout"),
      v.literal("refund_reserved"),
      v.literal("refund_paid"),
      v.literal("reversal"),
    ),
    status: v.literal("posted"),
    memo: v.string(),
    sourceReference: v.string(),
    contributorTokenIdentifier: v.optional(tokenIdentifier),
    reference: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
    effectiveAt: v.number(),
    recordedAt: v.number(),
    reversalOf: v.optional(v.id("journalEntries")),
  })
    .index("by_event_key", ["organizationId", "eventKey"])
    .index("by_order", ["orderId"])
    .index("by_org", ["organizationId"])
    .index("by_reversal_of", ["reversalOf"]),

  journalLines: defineTable({
    ...tenant,
    journalEntryId: v.id("journalEntries"),
    account: ledgerAccount,
    side: journalSide,
    amountAtomic,
    lineNumber: v.number(),
  })
    .index("by_entry", ["journalEntryId", "lineNumber"])
    .index("by_org_account", ["organizationId", "account"]),

  auditEvents: defineTable({
    ...tenant,
    eventKey: v.string(),
    actor,
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    reason: v.string(),
    evidenceReferences: v.array(v.string()),
    beforeHash: v.optional(v.string()),
    afterHash: v.optional(v.string()),
    occurredAt: v.number(),
  })
    .index("by_event_key", ["organizationId", "eventKey"])
    .index("by_org_time", ["organizationId", "occurredAt"])
    .index("by_entity", ["organizationId", "entityType", "entityId"]),

  outboxEvents: defineTable({
    ...tenant,
    eventKey: v.string(),
    kind: v.union(
      v.literal("publish_dataset"),
      v.literal("dispatch_settlement"),
      v.literal("reconcile_settlement"),
    ),
    orderId: v.id("orders"),
    submissionId: v.optional(v.id("submissions")),
    paymentCommandId: v.optional(v.id("paymentCommands")),
    paymentIntentId: v.optional(v.id("paymentIntents")),
    status: v.union(
      v.literal("pending"),
      v.literal("leased"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    availableAt: v.number(),
    attempt: v.number(),
    leaseGeneration: v.number(),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    lastErrorCode: v.optional(v.string()),
  })
    .index("by_event_key", ["organizationId", "eventKey"])
    .index("by_status_available", ["status", "availableAt"])
    .index("by_status_lease_expiry", ["status", "leaseExpiresAt"]),

  serviceRequests: defineTable({
    serviceId: v.string(),
    requestId: v.string(),
    method: v.string(),
    path: v.string(),
    bodyHash: v.string(),
    requestTimestampSeconds: v.number(),
    status: v.union(v.literal("accepted"), v.literal("completed")),
    responseHash: v.optional(v.string()),
    responseStatus: v.optional(v.number()),
    resultReference: v.optional(v.string()),
    resultLeaseGeneration: v.optional(v.number()),
    receivedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_service_request", ["serviceId", "requestId"])
    .index("by_expiry", ["expiresAt"]),
});
