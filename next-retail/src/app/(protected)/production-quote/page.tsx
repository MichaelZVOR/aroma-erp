import { redirect } from "next/navigation";
export default function ProductionQuotePage() {
  redirect("/production?tab=quote");
}
