import { describe, expect, it } from "vitest";
import { createSetupCommand } from "../../Cli/setup-playwright-command.js";

describe("Playwright setup CLI", () => {
  it("installs Chromium without system dependencies by default", () => {
    expect(createSetupCommand(["setup"], "linux")).toEqual({
      showHelp: false,
      playwrightArgs: ["install", "chromium"],
      withDepsIgnored: false,
    });
  });

  it("installs Linux system dependencies when requested", () => {
    expect(createSetupCommand(["setup", "--with-deps"], "linux")).toEqual({
      showHelp: false,
      playwrightArgs: ["install", "--with-deps", "chromium"],
      withDepsIgnored: false,
    });
  });

  it("ignores Linux-only system dependencies on other platforms", () => {
    expect(createSetupCommand(["setup", "--with-deps"], "win32")).toEqual({
      showHelp: false,
      playwrightArgs: ["install", "chromium"],
      withDepsIgnored: true,
    });
  });

  it("rejects unsupported commands and options", () => {
    expect(() => createSetupCommand([], "linux")).toThrow('Expected the command "setup".');
    expect(() => createSetupCommand(["setup", "--unknown"], "linux")).toThrow(
      "Unknown setup option: --unknown",
    );
  });
});
