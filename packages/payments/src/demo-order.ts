/** Public order abuse limits; commercial terms come from the source order. */
import { paymentConfig } from "./config.ts";
export const DEMO_ORDER_IP_LIMIT = paymentConfig.publicOrderIpLimit;
export const DEMO_ORDER_GLOBAL_LIMIT = paymentConfig.publicOrderGlobalLimit;
export const DEMO_ORDER_WINDOW_MS = paymentConfig.publicOrderWindowMs;
