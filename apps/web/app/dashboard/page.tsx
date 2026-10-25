"use client";
import { BuyerReview } from "@/features/dashboard/buyer-review";
import { RequireConvex } from "@/features/dashboard/ui";

export default function DashboardPage() {
  return <RequireConvex><BuyerReview /></RequireConvex>;
}
