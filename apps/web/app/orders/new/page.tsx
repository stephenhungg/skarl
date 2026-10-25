import { redirect } from "next/navigation";

/** Posting a task lives in the dashboard now. */
export default function NewOrderPage() {
  redirect("/dashboard/post");
}
