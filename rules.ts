export type RuleSource = "tag" | "fileName" | "folder" | "path";

export type RuleOperator =
  | "includes"
  | "notIncludes"
  | "is"
  | "isNot"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "matches"
  | "inside"
  | "notInside";

export interface ViewRuleCondition {
  id: string;
  source?: RuleSource;
  operator?: RuleOperator;
  value?: string;
}

export interface ViewRuleOutput {
  view: "reading" | "editing";
  editingMode?: "live" | "source";
}

export interface ViewRule {
  id: string;
  name: string;
  enabled: boolean;
  match?: "all" | "any";
  conditions: ViewRuleCondition[];
  output?: ViewRuleOutput;
}

export interface NoteFacts {
  tags: ReadonlySet<string>;
  fileName: string;
  folder: string;
  path: string;
}

export interface RuleResolution {
  ruleId: string;
  output: ViewRuleOutput;
}

export interface RuleValidation {
  valid: boolean;
  ruleErrors: string[];
  conditionErrors: Record<string, string>;
}

export const OPERATORS_BY_SOURCE: Record<RuleSource, RuleOperator[]> = {
  tag: ["includes", "notIncludes"],
  fileName: [
    "is",
    "isNot",
    "contains",
    "notContains",
    "startsWith",
    "endsWith",
    "matches",
  ],
  folder: ["is", "isNot", "inside", "notInside"],
  path: ["is", "isNot", "contains", "startsWith", "matches"],
};

export function validateRule(rule: ViewRule): RuleValidation {
  const ruleErrors: string[] = [];
  const conditionErrors: Record<string, string> = {};

  if (rule.conditions.length === 0) {
    ruleErrors.push("At least one condition is required");
  }

  if (!rule.output) {
    ruleErrors.push("Choose a view");
  } else if (rule.output.view === "editing" && !rule.output.editingMode) {
    ruleErrors.push("Choose an editing mode");
  }

  for (const condition of rule.conditions) {
    const error = validateCondition(condition);
    if (error) {
      conditionErrors[condition.id] = error;
    }
  }

  return {
    valid: ruleErrors.length === 0 && Object.keys(conditionErrors).length === 0,
    ruleErrors,
    conditionErrors,
  };
}

export function resolveViewRule(
  rules: ViewRule[],
  facts: NoteFacts
): RuleResolution | null {
  for (const rule of rules) {
    if (!rule.enabled || !validateRule(rule).valid) {
      continue;
    }

    const matches = rule.conditions.map((condition) =>
      conditionMatches(condition, facts)
    );
    const ruleMatches = rule.match === "any"
      ? matches.some(Boolean)
      : matches.every(Boolean);

    if (ruleMatches && rule.output) {
      return { ruleId: rule.id, output: rule.output };
    }
  }

  return null;
}

function validateCondition(condition: ViewRuleCondition): string | null {
  if (!condition.source) {
    return "Choose a source";
  }

  if (!condition.operator) {
    return "Choose an operator";
  }

  if (!OPERATORS_BY_SOURCE[condition.source].includes(condition.operator)) {
    return "Choose a valid operator";
  }

  if (!condition.value?.trim()) {
    return "Add a value";
  }

  if (condition.operator === "matches") {
    try {
      new RegExp(condition.value);
    } catch {
      return "Invalid regular expression";
    }
  }

  return null;
}

function conditionMatches(
  condition: ViewRuleCondition,
  facts: NoteFacts
): boolean {
  const { source, operator } = condition;
  const value = condition.value?.trim() ?? "";

  if (!source || !operator || !value) {
    return false;
  }

  if (source === "tag") {
    const normalizedTag = value.replace(/^#/, "").toLowerCase();
    const hasTag = Array.from(facts.tags).some(
      (tag) => tag.replace(/^#/, "").toLowerCase() === normalizedTag
    );
    return operator === "includes" ? hasTag : !hasTag;
  }

  if (source === "folder") {
    const folder = normalizePath(facts.folder);
    const expected = normalizePath(value);
    const isInside = folder === expected || folder.startsWith(`${expected}/`);

    switch (operator) {
      case "is":
        return folder === expected;
      case "isNot":
        return folder !== expected;
      case "inside":
        return isInside;
      case "notInside":
        return !isInside;
      default:
        return false;
    }
  }

  const actual = source === "fileName" ? facts.fileName : facts.path;
  return textMatches(actual, operator, value);
}

function textMatches(
  actual: string,
  operator: RuleOperator,
  expected: string
): boolean {
  if (operator === "matches") {
    return new RegExp(expected).test(actual);
  }

  const normalizedActual = actual.toLowerCase();
  const normalizedExpected = expected.toLowerCase();

  switch (operator) {
    case "is":
      return normalizedActual === normalizedExpected;
    case "isNot":
      return normalizedActual !== normalizedExpected;
    case "contains":
      return normalizedActual.includes(normalizedExpected);
    case "notContains":
      return !normalizedActual.includes(normalizedExpected);
    case "startsWith":
      return normalizedActual.startsWith(normalizedExpected);
    case "endsWith":
      return normalizedActual.endsWith(normalizedExpected);
    default:
      return false;
  }
}

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").toLowerCase();
}
