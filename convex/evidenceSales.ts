// Deployment entrypoint for paid x402 evidence sales; handlers live in packages/payments.
export { sample, sale, claim, confirm } from "../packages/payments/src/evidence-store";
