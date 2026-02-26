export interface RecordingRuleOptions {
  ignoreCmd?: string[];
  onlyCmd?: string[];
  importantCmd?: string[];
}

export interface RecordingDecision {
  shouldRecordDiff: boolean;
  reason: "important" | "only" | "ignore" | "default" | "only-miss";
}

const defaultIgnorePatterns: RegExp[] = [
  /^ls(\s|$)/i,
  /^cat(\s|$)/i,
  /^rg(\s|$)/i,
  /^grep(\s|$)/i,
  /^fd(\s|$)/i,
  /^find(\s|$)/i,
  /^pwd(\s|$)/i,
  /^which(\s|$)/i,
  /^stat(\s|$)/i,
  /^head(\s|$)/i,
  /^tail(\s|$)/i,
  /^wc(\s|$)/i,
  /^tree(\s|$)/i,
  /^git\s+(status|diff|log|show|branch|rev-parse|ls-files)(\s|$)/i
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePatterns(patterns: string[] | undefined): RegExp[] {
  if (!patterns || patterns.length === 0) {
    return [];
  }
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern, "i");
    } catch {
      return new RegExp(escapeRegExp(pattern), "i");
    }
  });
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(/-lc\s+(.+)$/);
  if (match) {
    return stripQuotes(match[1].trim());
  }
  return trimmed;
}

function matchesAny(patterns: RegExp[], command: string): boolean {
  return patterns.some((pattern) => pattern.test(command));
}

export function decideRecording(command: string, options: RecordingRuleOptions = {}): RecordingDecision {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    return { shouldRecordDiff: true, reason: "default" };
  }

  const important = compilePatterns(options.importantCmd);
  if (important.length && matchesAny(important, normalized)) {
    return { shouldRecordDiff: true, reason: "important" };
  }

  const only = compilePatterns(options.onlyCmd);
  if (only.length) {
    return matchesAny(only, normalized)
      ? { shouldRecordDiff: true, reason: "only" }
      : { shouldRecordDiff: false, reason: "only-miss" };
  }

  const ignore = defaultIgnorePatterns.concat(compilePatterns(options.ignoreCmd));
  if (matchesAny(ignore, normalized)) {
    return { shouldRecordDiff: false, reason: "ignore" };
  }

  return { shouldRecordDiff: true, reason: "default" };
}
