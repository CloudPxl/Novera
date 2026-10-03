import type { Metadata } from "next";
import { WorkspaceSettings } from "../workspace-settings.tsx";

export const metadata: Metadata = { title: "Developer · Settings · Novera" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <WorkspaceSettings section="developer" />;
}
