"use client";
import { PostTask } from "@/features/dashboard/post-task";
import { RequireConvex } from "@/features/dashboard/ui";

export default function PostTaskPage() {
  return <RequireConvex><PostTask /></RequireConvex>;
}
