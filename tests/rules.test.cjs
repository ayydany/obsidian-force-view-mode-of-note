const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "rules.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", compiled)(loaded, loaded.exports);

const { resolveViewRule, validateRule } = loaded.exports;

const reading = { view: "reading" };
const live = { view: "editing", editingMode: "live" };

function condition(id, source, operator, value) {
  return { id, source, operator, value };
}

function rule(id, conditions, output = reading) {
  return { id, name: id, enabled: true, conditions, output };
}

function facts(overrides = {}) {
  return {
    tags: new Set(["dashboard", "project/work"]),
    fileName: "Index.md",
    folder: "40 Chronology/2026",
    path: "40 Chronology/2026/Index.md",
    ...overrides,
  };
}

assert.equal(validateRule(rule("empty", [])).valid, false);
assert.equal(validateRule({
  id: "no-output",
  name: "no-output",
  enabled: true,
  conditions: [condition("c", "tag", "includes", "dashboard")],
}).valid, false);
assert.equal(
  validateRule(rule("bad-regex", [condition("c", "path", "matches", "[")])).valid,
  false
);

const negativeTag = rule("negative", [
  condition("c", "tag", "notIncludes", "draft"),
], live);
assert.deepEqual(resolveViewRule([negativeTag], facts()), {
  ruleId: "negative",
  output: live,
});
assert.equal(
  resolveViewRule([negativeTag], facts({ tags: new Set(["DRAFT"]) })),
  null
);

const exactNestedTag = rule("nested", [
  condition("c", "tag", "includes", "project"),
]);
assert.equal(resolveViewRule([exactNestedTag], facts()), null);

const matchAll = rule("all", [
  condition("a", "folder", "inside", "40 Chronology"),
  condition("b", "fileName", "is", "index.md"),
]);
assert.equal(resolveViewRule([matchAll], facts()).ruleId, "all");
assert.equal(
  resolveViewRule([matchAll], facts({ fileName: "Other.md" })),
  null
);

const matchAny = {
  ...rule("any", [
    condition("a", "tag", "includes", "dashboard"),
    condition("b", "tag", "includes", "foldernote"),
  ]),
  match: "any",
};
assert.equal(resolveViewRule([matchAny], facts()).ruleId, "any");
assert.equal(
  resolveViewRule([matchAny], facts({ tags: new Set(["unrelated"]) })),
  null
);

const highPriority = rule("high", [
  condition("a", "tag", "includes", "dashboard"),
], reading);
const lowPriority = rule("low", [
  condition("b", "tag", "includes", "dashboard"),
], live);
assert.equal(resolveViewRule([highPriority, lowPriority], facts()).ruleId, "high");

const invalidFirst = rule("invalid", [
  condition("a", "path", "matches", "[")
], live);
assert.equal(resolveViewRule([invalidFirst, lowPriority], facts()).ruleId, "low");

assert.equal(resolveViewRule([], facts()), null);

console.log("Rule resolver tests passed");
