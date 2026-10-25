import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  actor,
  amountAtomic,
  commitment,
  ledgerAccount,
  membershipRole,
  network,
  orderStatus,
  paymentStatus,
  pipelineStatus,
  recommendation,
  submissionStatus,
  usdcMint,
} from "./validators";

const tenant = { organizationId: v.id("organizations") };
const asset = { network, mint: usdcMint };

// This is a storage scaffold, not an implemented financial workflow.
// Indexes below are lookup indexes, NOT unique constraints. Future mutations
// must perform idempotency reads and dependent writes in one transaction.
export default defineSchema({
  organizations: defineTable({
    name: v.string(),
    createdBySubject: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
  }),

  memberships: defineTable({
    ...tenant,
    issuer: v.string(),
    subject: v.string(),
    roles: v.array(membershipRole),
    status: v.union(v.literal("active"), v.literal("revoked")),
    walletAddress: v.optional(v.string()),
    walletVerifiedAt: v.optional(v.number()),
  })
    .index("by_org_identity", ["organizationId", "issuer", "subject"])
    .index("by_identity", ["issuer", "subject"]),

  orders: defineTable({
    ...tenant,
    ...asset,
    publicId: v.string(),
    buyerSubject: v.string(),
    buyerWalletAddress: v.string(),
    title: v.string(),
    status: orderStatus,
    taskVersionId: v.optional(v.id("rubricVersions")),
    quantityRequested: v.number(),
    pricePerSampleAtomic: amountAtomic,
    contributorRateAtomic: amountAtomic,
    budgetAtomic: amountAtomic,
    acceptedCount: v.number(),
    deadlineAt: v.number(),
    termsHash: v.string(),
    updatedAt: v.number(),
  })
    .index("by_public_id", ["publicId"])
    .index("by_org_status", ["organizationId", "status"])
    .index("by_org_buyer", ["organizationId", "buyerSubject"]),

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
    createdBySubject: v.string(),
    frozenAt: v.optional(v.number()),
  }).index("by_order_version", ["orderId", "version"]),

  submissions: defineTable({
    ...tenant,
    orderId: v.id("orders"),
    taskVersionId: v.id("rubricVersions"),
    contributorSubject: v.string(),
    status: submissionStatus,
    clientRequestId: v.string(),
    originalAssetId: v.optional(v.id("mediaAssets")),
    consentRecordId: v.optional(v.id("consentRecords")),
    expectedSourceHash: v.optional(v.string()),
    sourceHash: v.optional(v.string()),
    currentAnalysisId: v.optional(v.id("analysisResults")),
    currentDecisionId: v.optional(v.id("reviewDecisions")),
    supersedesSubmissionId: v.optional(v.id("submissions")),
    updatedAt: v.number(),
  })
    .index("by_order_status", ["orderId", "status"])
    .index("by_contributor", ["organizationId", "contributorSubject"])
    .index("by_request", ["organizationId", "clientRequestId"])
    .index("by_source_hash", ["organizationId", "sourceHash"]),

  consentRecords: defineTable({
    ...tenant,
    submissionId: v.id("submissions"),
    contributorSubject: v.string(),
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

  analysisResults: defineTable({
    ...tenant,
    jobId: v.id("jobs"),
    submissionId: v.id("submissions"),
    taskVersionId: v.id("rubricVersions"),
    sourceHash: v.string(),
    pipelineVersion: v.string(),
    leaseGeneration: v.number(),
    implementation: v.union(v.literal("scaffold"), v.literal("inference")),
    pipelineStatus,
    recommendation,
    summary: v.string(),
    reportStorageId: v.id("_storage"),
    reportHash: v.string(),
    evidenceAssetIds: v.array(v.id("mediaAssets")),
    completedAt: v.number(),
  })
    .index("by_job_generation", ["jobId", "leaseGeneration"])
    .index("by_submission", ["submissionId"]),

  reviewDecisions: defineTable({
    ...tenant,
    submissionId: v.id("submissions"),
    analysisResultId: v.id("analysisResults"),
    taskVersionId: v.id("rubricVersions"),
    decisionKey: v.string(),
    decision: v.union(
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("request_correction"),
    ),
    reviewerSubject: v.string(),
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
    manifestStorageId: v.id("_storage"),
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
    contributorSubject: v.string(),
    recipientOwnerAddress: v.string(),
    amountAtomic,
    sourceEventKey: v.string(),
    status: paymentStatus,
    createdAt: v.number(),
  })
    .index("by_source_event", ["organizationId", "sourceEventKey"])
    .index("by_order", ["orderId"])
    .index("by_org_status", ["organizationId", "status"]),

  paymentIntents: defineTable({
    ...tenant,
    ...asset,
    orderId: v.id("orders"),
    intentId: v.string(),
    buyerWalletAddress: v.string(),
    recipientOwnerAddress: v.string(),
    amountAtomic,
    termsHash: v.string(),
    resourcePath: v.string(),
    x402Version: v.literal(2),
    paymentIdentifier: v.string(),
    expiresAt: v.number(),
    status: paymentStatus,
    updatedAt: v.number(),
  })
    .index("by_intent_id", ["intentId"])
    .index("by_payment_identifier", ["organizationId", "paymentIdentifier"])
    .index("by_order", ["orderId"]),

  approvals: defineTable({
    ...tenant,
    paymentCommandId: v.id("paymentCommands"),
    requestedBy: actor,
    approverSubject: v.string(),
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
    recipientOwnerAddress: v.string(),
    destinationTokenAccount: v.optional(v.string()),
    amountAtomic,
    bindingHash: v.string(),
    sourceVersion: v.string(),
    status: paymentStatus,
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
    .index("by_org_status", ["organizationId", "status"]),

  paymentAttempts: defineTable({
    ...tenant,
    ...asset,
    paymentIntentId: v.optional(v.id("paymentIntents")),
    paymentCommandId: v.optional(v.id("paymentCommands")),
    attemptId: v.string(),
    attempt: v.number(),
    amountAtomic,
    transactionSignature: v.optional(v.string()),
    serializedTransactionHash: v.optional(v.string()),
    blockhash: v.optional(v.string()),
    lastValidBlockHeight: v.optional(v.number()),
    status: paymentStatus,
    lastErrorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_attempt_id", ["attemptId"])
    .index("by_command", ["paymentCommandId"])
    .index("by_intent", ["paymentIntentId"])
    .index("by_signature", ["network", "transactionSignature"]),

  chainObservations: defineTable({
    ...tenant,
    ...asset,
    paymentAttemptId: v.id("paymentAttempts"),
    transactionSignature: v.string(),
    instructionIndex: v.number(),
    innerInstructionIndex: v.optional(v.number()),
    slot: v.number(),
    sourceTokenAccount: v.string(),
    destinationTokenAccount: v.string(),
    sourceOwnerAddress: v.string(),
    destinationOwnerAddress: v.string(),
    amountAtomic,
    feeLamports: v.int64(),
    commitment,
    succeeded: v.boolean(),
    observedAt: v.number(),
  })
    .index("by_transfer", ["network", "transactionSignature", "instructionIndex"])
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
    effectiveAt: v.number(),
    recordedAt: v.number(),
    reversalOf: v.optional(v.id("journalEntries")),
  })
    .index("by_event_key", ["organizationId", "eventKey"])
    .index("by_order", ["orderId"]),

  journalLines: defineTable({
    ...tenant,
    journalEntryId: v.id("journalEntries"),
    account: ledgerAccount,
    debitAtomic: amountAtomic,
    creditAtomic: amountAtomic,
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
