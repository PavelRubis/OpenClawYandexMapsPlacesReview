import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type SetupCommand = {
  showHelp: boolean;
  playwrightArgs: string[];
  withDepsIgnored: boolean;
};

export function createSetupCommand(args: string[], platform: NodeJS.Platform = process.platform): SetupCommand {
  if (args.includes("--help") || args.includes("-h")) {
    return { showHelp: true, playwrightArgs: [], withDepsIgnored: false };
  }

  const [command, ...options] = args;
  if (command !== "setup") {
    throw new Error('Expected the command "setup".');
  }

  const supportedOptions = new Set(["--with-deps"]);
  const unsupportedOption = options.find((option) => !supportedOptions.has(option));
  if (unsupportedOption !== undefined) {
    throw new Error(`Unknown setup option: ${unsupportedOption}`);
  }

  const withDeps = options.includes("--with-deps");
  const installSystemDependencies = withDeps && platform === "linux";

  return {
    showHelp: false,
    playwrightArgs: ["install", ...(installSystemDependencies ? ["--with-deps"] : []), "chromium"],
    withDepsIgnored: withDeps && !installSystemDependencies,
  };
}

export function runSetup(args: string[] = process.argv.slice(2), platform: NodeJS.Platform = process.platform): number {
  let command: SetupCommand;
  try {
    command = createSetupCommand(args, platform);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    return 2;
  }

  if (command.showHelp) {
    printUsage();
    return 0;
  }

  if (command.withDepsIgnored) {
    console.info("--with-deps installs OS packages only on Linux; continuing with the Chromium installation.");
  }

  const require = createRequire(import.meta.url);
  const playwrightPackageJson = require.resolve("playwright/package.json");
  const playwrightCli = join(dirname(playwrightPackageJson), "cli.js");
  const result = spawnSync(process.execPath, [playwrightCli, ...command.playwrightArgs], {
    stdio: "inherit",
  });

  if (result.error !== undefined) {
    console.error(`Could not start Playwright: ${result.error.message}`);
    return 1;
  }

  if (result.signal !== null) {
    console.error(`Playwright was terminated by ${result.signal}.`);
    return 1;
  }

  return result.status ?? 1;
}

function printUsage(): void {
  console.info(`Usage:
  openclaw-yandex-maps-places-review setup [--with-deps]

Options:
  --with-deps  Install required OS packages on Linux before installing Chromium.
  --help       Show this help.`);
}
