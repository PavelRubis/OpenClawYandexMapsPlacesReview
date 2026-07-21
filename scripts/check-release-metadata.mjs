import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const pluginManifest = JSON.parse(await readFile(resolve("openclaw.plugin.json"), "utf8"));
const expectedPluginId = "yandex-maps-places-review";
const expectedPackageName = "@sharleysoft/openclaw-yandex-maps-places-review";
const expectedBinName = "openclaw-yandex-maps-places-review";
const expectedRuntimeEntry = "./dist/index.js";
const expectedOpenClawFloor = ">=2026.6.11";

assertEqual(packageJson.name, expectedPackageName, "package name");
assertEqual(pluginManifest.id, expectedPluginId, "plugin id");
assertEqual(pluginManifest.version, packageJson.version, "manifest version");
assertEqual(packageJson.peerDependencies?.openclaw, expectedOpenClawFloor, "OpenClaw peer dependency");
assertEqual(packageJson.openclaw?.compat?.pluginApi, expectedOpenClawFloor, "OpenClaw plugin API floor");
assertEqual(packageJson.openclaw?.install?.minHostVersion, expectedOpenClawFloor, "OpenClaw host version floor");
assertEqual(packageJson.openclaw?.install?.npmSpec, expectedPackageName, "OpenClaw npm install spec");
assertEqual(packageJson.publishConfig?.access, "public", "npm publish access");

const runtimeEntries = packageJson.openclaw?.extensions;
if (!Array.isArray(runtimeEntries) || runtimeEntries.length !== 1 || runtimeEntries[0] !== expectedRuntimeEntry) {
  throw new Error(`openclaw.extensions must contain only ${JSON.stringify(expectedRuntimeEntry)}.`);
}

assertEqual(packageJson.bin?.[expectedBinName], "./dist/Cli/setup-playwright.js", "setup CLI entry");
await access(resolve("dist/index.js"));
await access(resolve("dist/Cli/setup-playwright.js"));

const tag = readTag(process.argv.slice(2)) ?? process.env.GITHUB_REF_NAME;
if (tag !== undefined) {
  assertEqual(tag, `v${packageJson.version}`, "release tag");
}

console.info(
  `Release metadata is consistent for ${expectedPackageName}@${packageJson.version}` +
    (tag === undefined ? "." : ` (${tag}).`),
);

function readTag(args) {
  const tagFlagIndex = args.indexOf("--tag");
  if (tagFlagIndex === -1) {
    return undefined;
  }

  const value = args[tagFlagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--tag requires a value.");
  }

  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}
