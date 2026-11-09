import type { ReactNode } from "react";
import ShellView from "./ShellView";
import { requireLocalAdmin } from "../../server/local-auth";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  await requireLocalAdmin();
  return <ShellView>{children}</ShellView>;
}
