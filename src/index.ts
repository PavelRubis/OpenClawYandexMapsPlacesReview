import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { yandexMapsPlaceReviewsConfigSchema } from "./Schemas/yandex-maps-place-reviews-config.schema.js";
import { createYandexMapsPlaceReviewsTool } from "./Tools/yandex-maps-place-reviews.tool.js";

export default defineToolPlugin({
  id: "yandex-maps-places-review",
  name: "Yandex Maps Places Review",
  description: "Collect recent public Yandex Maps place reviews with browser automation.",
  configSchema: yandexMapsPlaceReviewsConfigSchema,
  tools: (tool) => [createYandexMapsPlaceReviewsTool(tool)],
});
