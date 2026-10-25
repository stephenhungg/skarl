import { query } from "./_generated/server";
import { PAYMENT_NETWORK } from "../packages/contracts/src/chain";

/** Public non-sensitive capability check, not proof of settlement or real authentication. */
export const status = query({
  args: {},
  handler: () => ({
    service: "skarl" as const,
    stage: "demo_backend" as const,
    network: PAYMENT_NETWORK,
    financialMutationsImplemented: true,
    demoIdentityOnly: true,
    productionAuthenticationImplemented: false,
    workerGatewayImplemented: false,
    livePaymentsImplemented: true,
    paymentsServiceConfigured: (process.env.SKARL_PAYMENTS_SERVICE_SECRET?.length ?? 0) >= 32,
    inferenceConfigured: !!process.env.GEMINI_API_KEY?.trim(),
    inferenceImplemented: true,
    mediaUploadsImplemented: true,
    modelAvailabilityCheckedByHealth: false,
    visualInput: "timestamped_jpeg_frames" as const,
  }),
});
