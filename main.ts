import {
  AbstractInputSuggest,
  App,
  CachedMetadata,
  MarkdownView,
  Modal,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  getAllTags,
} from "obsidian";
import {
  NoteFacts,
  OPERATORS_BY_SOURCE,
  RuleOperator,
  RuleSource,
  ViewRule,
  ViewRuleCondition,
  ViewRuleOutput,
  resolveViewRule,
  validateRule,
} from "./rules";

interface NoteViewRulesSettings {
  debounceTimeout: number;
  ignoreOpenFiles: boolean;
  rules: ViewRule[];
}

interface DesiredViewState {
  mode?: "preview" | "source";
  source?: boolean;
}

const DEFAULT_SETTINGS: NoteViewRulesSettings = {
  debounceTimeout: 0,
  ignoreOpenFiles: false,
  rules: [],
};

const SOURCE_LABELS: Record<RuleSource, string> = {
  tag: "Tag",
  fileName: "File name",
  folder: "Folder",
  path: "Full path",
};

const OPERATOR_LABELS: Record<RuleOperator, string> = {
  includes: "includes",
  notIncludes: "does not include",
  is: "is",
  isNot: "is not",
  contains: "contains",
  notContains: "does not contain",
  startsWith: "starts with",
  endsWith: "ends with",
  matches: "matches regex",
  inside: "is inside",
  notInside: "is not inside",
};

export default class NoteViewRulesPlugin extends Plugin {
  settings: NoteViewRulesSettings;
  openedFiles = new Set<string>();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new NoteViewRulesSettingTab(this.app, this));
    this.openedFiles = getOpenNotePaths(this.app);

    const evaluateLeaf = async (leaf: WorkspaceLeaf | null) => {
      if (!leaf || !(leaf.view instanceof MarkdownView) || !leaf.view.file) {
        return;
      }

      const view = leaf.view;
      if (this.settings.ignoreOpenFiles && this.openedFiles.has(view.file.path)) {
        this.openedFiles = getOpenNotePaths(this.app);
        return;
      }

      const cache = this.app.metadataCache.getFileCache(view.file);
      const facts = createNoteFacts(view.file, cache);
      const resolution = resolveViewRule(this.settings.rules, facts);
      const desired = resolution
        ? desiredStateFromOutput(resolution.output)
        : desiredStateFromFrontmatter(cache);

      if (desired) {
        await applyDesiredState(leaf, view, desired);
      }

      if (this.settings.ignoreOpenFiles) {
        this.openedFiles = getOpenNotePaths(this.app);
      }
    };

    let evaluationTimer: number | null = null;
    const handleLeaf = (leaf: WorkspaceLeaf | null) => {
      if (evaluationTimer !== null) {
        window.clearTimeout(evaluationTimer);
      }

      if (this.settings.debounceTimeout === 0) {
        void evaluateLeaf(leaf);
        return;
      }

      evaluationTimer = window.setTimeout(() => {
        evaluationTimer = null;
        void evaluateLeaf(leaf);
      }, this.settings.debounceTimeout);
    };
    this.register(() => {
      if (evaluationTimer !== null) {
        window.clearTimeout(evaluationTimer);
      }
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => handleLeaf(leaf))
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        const leaf = this.app.workspace.activeLeaf;
        if (
          file &&
          leaf?.view instanceof MarkdownView &&
          leaf.view.file?.path === file.path
        ) {
          handleLeaf(leaf);
        }
      })
    );
  }

  async loadSettings() {
    const loaded = (await this.loadData()) ?? {};
    this.settings = {
      debounceTimeout: Number.isFinite(loaded.debounceTimeout)
        ? Math.max(0, loaded.debounceTimeout)
        : DEFAULT_SETTINGS.debounceTimeout,
      ignoreOpenFiles: loaded.ignoreOpenFiles === true,
      rules: Array.isArray(loaded.rules) ? loaded.rules : [],
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

function createNoteFacts(file: TFile, cache: CachedMetadata | null): NoteFacts {
  return {
    tags: new Set(getAllTags(cache) ?? []),
    fileName: file.name,
    folder: file.parent?.path ?? "",
    path: file.path,
  };
}

function desiredStateFromOutput(output: ViewRuleOutput): DesiredViewState {
  if (output.view === "reading") {
    return { mode: "preview", source: false };
  }

  return {
    mode: "source",
    source: output.editingMode === "source",
  };
}

function desiredStateFromFrontmatter(
  cache: CachedMetadata | null
): DesiredViewState | null {
  const frontmatter = cache?.frontmatter;
  if (!frontmatter) {
    return null;
  }

  const uiMode = frontmatter.obsidianUIMode;
  const editingMode = frontmatter.obsidianEditingMode;
  const desired: DesiredViewState = {};

  if (uiMode === "preview") {
    desired.mode = "preview";
    desired.source = false;
  } else if (uiMode === "source" || uiMode === "live") {
    desired.mode = "source";
  }

  if (editingMode === "source" || editingMode === "live") {
    desired.source = editingMode === "source";
  }

  return desired.mode !== undefined || desired.source !== undefined
    ? desired
    : null;
}

async function applyDesiredState(
  leaf: WorkspaceLeaf,
  view: MarkdownView,
  desired: DesiredViewState
): Promise<void> {
  const state = leaf.getViewState();
  const currentState = state.state ?? {};
  const modeChanged = desired.mode !== undefined && view.getMode() !== desired.mode;
  const sourceChanged =
    desired.source !== undefined && currentState.source !== desired.source;

  if (!modeChanged && !sourceChanged) {
    return;
  }

  await leaf.setViewState({
    ...state,
    state: {
      ...currentState,
      ...(desired.mode !== undefined ? { mode: desired.mode } : {}),
      ...(desired.source !== undefined ? { source: desired.source } : {}),
    },
  });
}

function getOpenNotePaths(app: App): Set<string> {
  const paths = new Set<string>();
  app.workspace.iterateAllLeaves((leaf) => {
    if (leaf.view instanceof MarkdownView && leaf.view.file) {
      paths.add(leaf.view.file.path);
    }
  });
  return paths;
}

class StringInputSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly values: string[]
  ) {
    super(app, inputEl);
  }

  protected getSuggestions(query: string): string[] {
    const normalizedQuery = query.replace(/^#/, "").toLowerCase();
    return this.values
      .filter((value) => value.toLowerCase().includes(normalizedQuery))
      .slice(0, 100);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }
}

class RuleEditorModal extends Modal {
  private suggesters: StringInputSuggest[] = [];

  constructor(
    app: App,
    private readonly plugin: NoteViewRulesPlugin,
    private readonly rule: ViewRule,
    private readonly onChanged: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("note-view-rule-editor-modal");
    this.render();
  }

  onClose(): void {
    this.closeSuggesters();
    this.contentEl.empty();
    this.onChanged();
  }

  private render(): void {
    this.closeSuggesters();
    this.contentEl.empty();
    this.setTitle(`Edit ${this.rule.name.trim() || "Untitled rule"}`);

    new Setting(this.contentEl)
      .setName("Conditions")
      .setDesc(
        this.rule.conditions.length === 0
          ? "At least one condition is required."
          : this.rule.match === "any"
            ? "Any condition may match."
            : "Every condition must match."
      )
      .setClass("note-view-rule-conditions-header")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("all", "ALL")
          .addOption("any", "ANY")
          .setValue(this.rule.match ?? "all")
          .onChange(async (value) => {
            this.rule.match = value === "any" ? "any" : "all";
            await this.plugin.saveSettings();
            this.render();
          })
      )
      .addExtraButton((button) =>
        button.setIcon("plus").setTooltip("Add condition").onClick(async () => {
          this.rule.conditions.push({ id: createId("condition") });
          await this.plugin.saveSettings();
          this.render();
        })
      );

    const tagSuggestions = collectVaultTags(this.app);
    const folderSuggestions = collectVaultFolders(this.app);
    this.rule.conditions.forEach((condition, index) => {
      this.renderCondition(
        condition,
        index,
        tagSuggestions,
        folderSuggestions
      );
    });

    this.renderOutput();
  }

  private renderCondition(
    condition: ViewRuleCondition,
    index: number,
    tagSuggestions: string[],
    folderSuggestions: string[]
  ): void {
    const conditionEl = this.contentEl.createDiv({
      cls: "note-view-rule-condition",
    });
    const setting = new Setting(conditionEl);
    setting.setClass("note-view-rule-condition-row");
    setting.infoEl.remove();

    setting.addDropdown((dropdown) => {
      dropdown.addOption("", "Choose source…");
      for (const [source, label] of Object.entries(SOURCE_LABELS)) {
        dropdown.addOption(source, label);
      }
      dropdown.setValue(condition.source ?? "").onChange(async (value) => {
        condition.source = value ? value as RuleSource : undefined;
        condition.operator = undefined;
        condition.value = undefined;
        await this.plugin.saveSettings();
        this.render();
      });
    });

    if (condition.source) {
      setting.addDropdown((dropdown) => {
        dropdown.addOption("", "Choose operator…");
        for (const operator of OPERATORS_BY_SOURCE[condition.source!]) {
          dropdown.addOption(operator, OPERATOR_LABELS[operator]);
        }
        dropdown.setValue(condition.operator ?? "").onChange(async (value) => {
          condition.operator = value ? value as RuleOperator : undefined;
          condition.value = undefined;
          await this.plugin.saveSettings();
          this.render();
        });
      });
    }

    if (condition.source && condition.operator) {
      setting.addSearch((search) => {
        search
          .setPlaceholder(conditionValuePlaceholder(condition.source!))
          .setValue(condition.value ?? "")
          .onChange(async (value) => {
            condition.value = value;
            await this.plugin.saveSettings();
            this.updateConditionError(conditionEl, condition);
          });

        const suggestions = condition.source === "tag"
          ? tagSuggestions
          : condition.source === "folder"
            ? folderSuggestions
            : [];
        if (suggestions.length > 0) {
          const suggester = new StringInputSuggest(
            this.app,
            search.inputEl,
            suggestions
          );
          suggester.onSelect(async (value) => {
            search.setValue(value);
            condition.value = value;
            await this.plugin.saveSettings();
            this.updateConditionError(conditionEl, condition);
          });
          this.suggesters.push(suggester);
        }
      });
    }

    setting.addExtraButton((button) =>
      button
        .setIcon("trash-2")
        .setTooltip("Remove condition")
        .onClick(async () => {
          this.rule.conditions.splice(index, 1);
          await this.plugin.saveSettings();
          this.render();
        })
    );
    this.updateConditionError(conditionEl, condition);
  }

  private updateConditionError(
    conditionEl: HTMLElement,
    condition: ViewRuleCondition
  ): void {
    conditionEl.querySelector(".note-view-rule-condition-error")?.remove();
    const error = validateRule(this.rule).conditionErrors[condition.id];
    if (error) {
      conditionEl.createDiv({
        cls: "note-view-rule-condition-error",
        text: error,
      });
    }
  }

  private renderOutput(): void {
    const outputSetting = new Setting(this.contentEl)
      .setName("Open in")
      .setDesc(outputError(this.rule));
    outputSetting.setClass("note-view-rule-output");
    outputSetting.addDropdown((dropdown) =>
      dropdown
        .addOption("", "Choose view…")
        .addOption("reading", "Reading view")
        .addOption("editing", "Editing view")
        .setValue(this.rule.output?.view ?? "")
        .onChange(async (value) => {
          this.rule.output = value === "reading"
            ? { view: "reading" }
            : value === "editing"
              ? { view: "editing" }
              : undefined;
          await this.plugin.saveSettings();
          this.render();
        })
    );

    if (this.rule.output?.view === "editing") {
      outputSetting.addDropdown((dropdown) =>
        dropdown
          .addOption("", "Choose editing mode…")
          .addOption("live", "Live Preview")
          .addOption("source", "Source mode")
          .setValue(this.rule.output?.editingMode ?? "")
          .onChange(async (value) => {
            if (this.rule.output?.view === "editing") {
              this.rule.output.editingMode = value === "live" || value === "source"
                ? value
                : undefined;
              await this.plugin.saveSettings();
              outputSetting.setDesc(outputError(this.rule));
            }
          })
      );
    }
  }

  private closeSuggesters(): void {
    for (const suggester of this.suggesters) {
      suggester.close();
    }
    this.suggesters = [];
  }
}

class NoteViewRulesSettingTab extends PluginSettingTab {
  private pendingDeleteId: string | null = null;
  private draggedRuleId: string | null = null;

  constructor(app: App, private readonly plugin: NoteViewRulesPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("note-view-rules-settings");

    new Setting(containerEl)
      .setName("Rules")
      .setDesc(
        "Rules run from top to bottom. The first matching rule wins. If no rule matches, Obsidian keeps its chosen view."
      )
      .setHeading()
      .addExtraButton((button) =>
        button.setIcon("plus").setTooltip("Add rule").onClick(async () => {
          const rule = createEmptyRule();
          this.plugin.settings.rules.push(rule);
          await this.plugin.saveSettings();
          this.display();
          this.openRuleEditor(rule);
        })
      );

    const rulesListEl = containerEl.createDiv({ cls: "note-view-rules-list" });

    if (this.plugin.settings.rules.length === 0) {
      new Setting(rulesListEl)
        .setName("No rules yet")
        .setDesc("Unmatched notes are left unchanged.")
        .setClass("note-view-rules-empty");
    }

    for (const rule of this.plugin.settings.rules) {
      this.renderRule(rulesListEl, rule);
    }

    const advanced = containerEl.createEl("details", {
      cls: "note-view-rules-advanced",
    });
    advanced.createEl("summary", { text: "Advanced" });

    new Setting(advanced)
      .setName("Ignore already-open notes")
      .setDesc("Do not change the view of a note that is already open in a leaf.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.ignoreOpenFiles)
          .onChange(async (value) => {
            this.plugin.settings.ignoreOpenFiles = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(advanced)
      .setName("Debounce timeout")
      .setDesc("Delay rule evaluation after opening a note, in milliseconds. Use 0 for immediate evaluation.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.debounceTimeout))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 0) {
              this.plugin.settings.debounceTimeout = parsed;
              await this.plugin.saveSettings();
            }
          })
      );
  }

  private renderRule(
    containerEl: HTMLElement,
    rule: ViewRule
  ): void {
    const validation = validateRule(rule);
    const ruleEl = containerEl.createDiv({ cls: "note-view-rule" });
    ruleEl.toggleClass("is-disabled", !rule.enabled);
    this.attachDropTarget(ruleEl, rule.id);

    const header = new Setting(ruleEl)
      .setName(rule.name.trim() || "Untitled rule")
      .setDesc(ruleSummary(rule, validation));
    header.setClass("note-view-rule-header");
    this.makeRuleNameEditable(header, rule);

    header.addExtraButton((button) => {
      button.setIcon("grip-vertical").setTooltip("Drag to reorder");
      const handle = button.extraSettingsEl;
      handle.setAttr("draggable", "true");
      handle.addClass("note-view-rule-grip");
      header.settingEl.insertBefore(handle, header.infoEl);
      handle.addEventListener("dragstart", (event) => {
        this.draggedRuleId = rule.id;
        event.dataTransfer?.setData("text/plain", rule.id);
        event.dataTransfer?.setDragImage(header.settingEl, 16, 16);
        ruleEl.addClass("is-dragging");
      });
      handle.addEventListener("dragend", () => {
        this.draggedRuleId = null;
        ruleEl.removeClass("is-dragging");
      });
    });
    header.addToggle((toggle) =>
      toggle.setValue(rule.enabled).onChange(async (value) => {
        rule.enabled = value;
        await this.plugin.saveSettings();
        this.display();
      })
    );
    header.addExtraButton((button) =>
      button.setIcon("copy").setTooltip("Duplicate rule").onClick(async () => {
        const copy = duplicateRule(rule);
        const index = this.plugin.settings.rules.indexOf(rule);
        this.plugin.settings.rules.splice(index + 1, 0, copy);
        await this.plugin.saveSettings();
        this.display();
      })
    );

    if (this.pendingDeleteId === rule.id) {
      header.addExtraButton((button) =>
        button.setIcon("check").setTooltip("Confirm delete").onClick(async () => {
          this.plugin.settings.rules = this.plugin.settings.rules.filter(
            (candidate) => candidate.id !== rule.id
          );
          this.pendingDeleteId = null;
          await this.plugin.saveSettings();
          this.display();
        })
      );
      header.addExtraButton((button) =>
        button.setIcon("x").setTooltip("Cancel delete").onClick(() => {
          this.pendingDeleteId = null;
          this.display();
        })
      );
    } else {
      header.addExtraButton((button) =>
        button.setIcon("trash-2").setTooltip("Delete rule").onClick(() => {
          this.pendingDeleteId = rule.id;
          this.display();
        })
      );
    }

    header.addExtraButton((button) =>
      button
        .setIcon("pencil")
        .setTooltip("Edit rule")
        .onClick(() => this.openRuleEditor(rule))
    );
  }

  private openRuleEditor(rule: ViewRule): void {
    new RuleEditorModal(
      this.app,
      this.plugin,
      rule,
      () => this.display()
    ).open();
  }

  private attachDropTarget(ruleEl: HTMLElement, targetRuleId: string): void {
    ruleEl.addEventListener("dragover", (event) => {
      if (this.draggedRuleId && this.draggedRuleId !== targetRuleId) {
        event.preventDefault();
        ruleEl.addClass("is-drag-over");
      }
    });
    ruleEl.addEventListener("dragleave", () => ruleEl.removeClass("is-drag-over"));
    ruleEl.addEventListener("drop", async (event) => {
      event.preventDefault();
      ruleEl.removeClass("is-drag-over");
      const sourceId = this.draggedRuleId ?? event.dataTransfer?.getData("text/plain");
      if (!sourceId || sourceId === targetRuleId) {
        return;
      }

      const sourceIndex = this.plugin.settings.rules.findIndex(
        (rule) => rule.id === sourceId
      );
      const targetIndex = this.plugin.settings.rules.findIndex(
        (rule) => rule.id === targetRuleId
      );
      if (sourceIndex < 0 || targetIndex < 0) {
        return;
      }

      const insertAfter = event.clientY > ruleEl.getBoundingClientRect().top + ruleEl.clientHeight / 2;
      const [moved] = this.plugin.settings.rules.splice(sourceIndex, 1);
      let insertionIndex = this.plugin.settings.rules.findIndex(
        (rule) => rule.id === targetRuleId
      );
      if (insertAfter) {
        insertionIndex += 1;
      }
      this.plugin.settings.rules.splice(insertionIndex, 0, moved);
      this.draggedRuleId = null;
      await this.plugin.saveSettings();
      this.display();
    });
  }

  private makeRuleNameEditable(header: Setting, rule: ViewRule): void {
    const nameEl = header.nameEl;
    nameEl.setAttr("tabindex", "0");
    nameEl.setAttr("title", "Click to rename");

    const startEditing = () => {
      nameEl.setAttr("contenteditable", "true");
      nameEl.focus();
      const selection = window.getSelection();
      selection?.selectAllChildren(nameEl);
      selection?.collapseToEnd();
    };

    nameEl.addEventListener("click", startEditing);
    nameEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        nameEl.blur();
      } else if (event.key === "Escape") {
        nameEl.setText(rule.name.trim() || "Untitled rule");
        nameEl.removeAttribute("contenteditable");
        nameEl.blur();
      }
    });
    nameEl.addEventListener("blur", async () => {
      if (nameEl.getAttribute("contenteditable") !== "true") {
        return;
      }
      const value = nameEl.innerText.trim() || "Untitled rule";
      nameEl.removeAttribute("contenteditable");
      nameEl.setText(value);
      rule.name = value;
      await this.plugin.saveSettings();
    });
  }
}

function createEmptyRule(): ViewRule {
  return {
    id: createId("rule"),
    name: "Untitled rule",
    enabled: true,
    match: "all",
    conditions: [],
  };
}

function duplicateRule(rule: ViewRule): ViewRule {
  return {
    ...rule,
    id: createId("rule"),
    name: `${rule.name || "Untitled rule"} copy`,
    match: rule.match ?? "all",
    conditions: rule.conditions.map((condition) => ({
      ...condition,
      id: createId("condition"),
    })),
    output: rule.output ? { ...rule.output } : undefined,
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function collectVaultTags(app: App): string[] {
  const tags = new Set<string>();
  for (const file of app.vault.getMarkdownFiles()) {
    for (const tag of getAllTags(app.metadataCache.getFileCache(file)) ?? []) {
      tags.add(tag.replace(/^#/, ""));
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

function collectVaultFolders(app: App): string[] {
  return app.vault
    .getAllLoadedFiles()
    .filter((file): file is TFolder => file instanceof TFolder && file.path !== "/")
    .map((folder) => folder.path)
    .sort((a, b) => a.localeCompare(b));
}

function ruleSummary(
  rule: ViewRule,
  validation: ReturnType<typeof validateRule>
): string {
  const count = rule.conditions.length;
  const conditionSummary = `${count} condition${count === 1 ? "" : "s"}`;
  const outputSummary = outputLabel(rule.output);
  return validation.valid
    ? `${conditionSummary} · ${outputSummary}`
    : `${conditionSummary} · Needs configuration`;
}

function outputLabel(output?: ViewRuleOutput): string {
  if (!output) {
    return "No view selected";
  }
  if (output.view === "reading") {
    return "Reading view";
  }
  return output.editingMode === "source"
    ? "Editing · Source mode"
    : output.editingMode === "live"
      ? "Editing · Live Preview"
      : "Editing · Choose mode";
}

function outputError(rule: ViewRule): string {
  return validateRule(rule).ruleErrors.find((error) =>
    error === "Choose a view" || error === "Choose an editing mode"
  ) ?? "";
}

function conditionValuePlaceholder(source: RuleSource): string {
  switch (source) {
    case "tag":
      return "Select or enter a tag";
    case "folder":
      return "Select or enter a folder";
    case "fileName":
      return "Example: Index.md";
    case "path":
      return "Example: 40 Chronology/2026/Index.md";
  }
}
