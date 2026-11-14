import { type App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";

import type TrashExplorerPlugin from "./main";
import type { DatePreset, ViewMode } from "./model";

export interface TrashExplorerSettings {
  defaultDate: DatePreset;
  defaultView: ViewMode;
  hideExisting: boolean;
  showConfigFiles: boolean;
}

export const DEFAULT_SETTINGS: TrashExplorerSettings = {
  defaultDate: "any",
  defaultView: "list",
  hideExisting: true,
  showConfigFiles: false,
};

export const DATE_LABELS: Record<DatePreset, string> = {
  any: "Any time",
  "1d": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "365d": "Last year",
  custom: "Custom range",
};

const DATE_PRESETS = Object.keys(DATE_LABELS) as DatePreset[];

function isDatePreset(value: unknown): value is DatePreset {
  return typeof value === "string" && (DATE_PRESETS as string[]).includes(value);
}

/** Reads stored data and keeps only known, valid values. */
export function parseSettings(raw: unknown): TrashExplorerSettings {
  const settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== "object" || raw === null) return settings;
  const data = raw as Record<string, unknown>;
  if (isDatePreset(data.defaultDate) && data.defaultDate !== "custom") settings.defaultDate = data.defaultDate;
  if (data.defaultView === "list" || data.defaultView === "tree") settings.defaultView = data.defaultView;
  if (typeof data.hideExisting === "boolean") settings.hideExisting = data.hideExisting;
  if (typeof data.showConfigFiles === "boolean") settings.showConfigFiles = data.showConfigFiles;
  return settings;
}

export class TrashExplorerSettingTab extends PluginSettingTab {
  private readonly plugin: TrashExplorerPlugin;

  constructor(app: App, plugin: TrashExplorerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Obsidian 1.13 and newer: declarative settings, also found by the settings search. */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    const dateOptions: Record<string, string> = {};
    for (const preset of DATE_PRESETS) if (preset !== "custom") dateOptions[preset] = DATE_LABELS[preset];
    return [
      {
        name: "Default date filter",
        desc: "The deleted-date filter that the explorer starts with.",
        control: {
          type: "dropdown",
          key: "defaultDate",
          options: dateOptions,
          defaultValue: DEFAULT_SETTINGS.defaultDate,
        },
      },
      {
        name: "Default layout",
        desc: "Show deleted files as one list, or grouped in their original folders.",
        control: {
          type: "dropdown",
          key: "defaultView",
          options: { list: "List", tree: "Folder tree" },
          defaultValue: DEFAULT_SETTINGS.defaultView,
        },
      },
      {
        name: "Hide files that exist again",
        desc: "Hide deleted paths that have a file in the vault now, for example after a restore.",
        control: { type: "toggle", key: "hideExisting", defaultValue: DEFAULT_SETTINGS.hideExisting },
      },
      {
        name: "Show configuration folder files",
        desc: `Include deleted files from the ${this.app.vault.configDir} folder, such as old plugin files.`,
        control: { type: "toggle", key: "showConfigFiles", defaultValue: DEFAULT_SETTINGS.showConfigFiles },
      },
    ];
  }

  /**
   * Obsidian 1.13+ calls this when a declarative control changes. It does not
   * call the base method (also 1.13+), so the plugin keeps minAppVersion 1.8.0.
   */
  override async setControlValue(key: string, value: unknown): Promise<void> {
    Object.assign(this.plugin.settings, parseSettings({ ...this.plugin.settings, [key]: value }));
    await this.plugin.saveSettings();
    if (key === "showConfigFiles") this.plugin.refreshViews();
  }

  /** Fallback for Obsidian versions older than 1.13. */
  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("Default date filter")
      .setDesc("The deleted-date filter that the explorer starts with.")
      .addDropdown((dropdown) => {
        for (const preset of DATE_PRESETS) if (preset !== "custom") dropdown.addOption(preset, DATE_LABELS[preset]);
        dropdown.setValue(settings.defaultDate).onChange(async (value) => {
          if (isDatePreset(value)) settings.defaultDate = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Default layout")
      .setDesc("Show deleted files as one list, or grouped in their original folders.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("list", "List")
          .addOption("tree", "Folder tree")
          .setValue(settings.defaultView)
          .onChange(async (value) => {
            settings.defaultView = value === "tree" ? "tree" : "list";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Hide files that exist again")
      .setDesc("Hide deleted paths that have a file in the vault now, for example after a restore.")
      .addToggle((toggle) =>
        toggle.setValue(settings.hideExisting).onChange(async (value) => {
          settings.hideExisting = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Show configuration folder files")
      .setDesc(`Include deleted files from the ${this.app.vault.configDir} folder, such as old plugin files.`)
      .addToggle((toggle) =>
        toggle.setValue(settings.showConfigFiles).onChange(async (value) => {
          settings.showConfigFiles = value;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }),
      );
  }
}
