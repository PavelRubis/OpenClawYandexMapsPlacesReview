import { describe, expect, it } from "vitest";
import plugin from "../../index.js";

type PluginMetadataForTest = {
  configSchema: {
    properties: {
      logLevel?: unknown;
    };
  };
  tools: Array<{
    name: string;
    parameters: {
      properties: {
        logLevel?: unknown;
      };
    };
  }>;
};

describe("OpenClaw plugin entry", () => {
  it("declares the yandex_maps_place_reviews tool", () => {
    const metadata = getOpenClawMetadata(plugin);

    expect(metadata.tools).toHaveLength(1);
    expect(metadata.tools[0].name).toBe("yandex_maps_place_reviews");
  });

  it("keeps logLevel in config, not tool parameters", () => {
    const metadata = getOpenClawMetadata(plugin);

    expect(metadata.configSchema.properties.logLevel).toBeDefined();
    expect(metadata.tools[0].parameters.properties.logLevel).toBeUndefined();
  });
});

function getOpenClawMetadata(value: unknown): PluginMetadataForTest {
  const symbol = Object.getOwnPropertySymbols(value as object).find((candidate) =>
    candidate.description?.includes("openclaw.plugin-sdk.tool-plugin.metadata"),
  );

  if (symbol === undefined) {
    throw new Error("OpenClaw metadata symbol not found.");
  }

  return (value as Record<symbol, PluginMetadataForTest>)[symbol];
}
