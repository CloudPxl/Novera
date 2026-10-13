import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The date a documentation file last changed in git, as an ISO date, or null.
 * Null when git or history is unavailable (a shallow or history-less deploy): a date that
 * cannot be read is left out of the sitemap rather than replaced with the build time.
 */
export function lastCommitDate(relativePath: string, cwd = process.cwd()): Date | null {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", relativePath], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000,
    }).trim();
    const d = new Date(out);
    return out && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

export function docFile(slug: string): string {
  return join("data/docs", `${slug}.md`);
}
