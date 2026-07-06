import type { DefineToolPluginOptions } from "openclaw/plugin-sdk/tool-plugin";
import type { LogLevel } from "../Application/Dtos/yandex-maps-place-reviews.dto.js";
import { createToolCallHandlers } from "../Composition/create-tool-call-handlers.js";
import { yandexMapsPlaceReviewsConfigSchema } from "../Schemas/yandex-maps-place-reviews-config.schema.js";
import { yandexMapsPlaceReviewsParametersSchema } from "../Schemas/yandex-maps-place-reviews-parameters.schema.js";

type YandexMapsPlaceReviewsConfigSchema = typeof yandexMapsPlaceReviewsConfigSchema;
type YandexMapsPlaceReviewsToolFactory = Parameters<
  DefineToolPluginOptions<YandexMapsPlaceReviewsConfigSchema>["tools"]
>[0];
type YandexMapsPlaceReviewsTool = ReturnType<YandexMapsPlaceReviewsToolFactory>;

export function createYandexMapsPlaceReviewsTool(tool: YandexMapsPlaceReviewsToolFactory): YandexMapsPlaceReviewsTool {
  return tool({
    name: "yandex_maps_place_reviews",
    label: "Yandex Maps Place Reviews",
    description: "Return the latest public reviews for a Yandex Maps place URL.",
    parameters: yandexMapsPlaceReviewsParametersSchema,
    async execute(params, config, context) {
      context.signal?.throwIfAborted();

      const handlers = createToolCallHandlers({
        logLevel: (config.logLevel ?? "info") as LogLevel,
      });

      return handlers.getYandexMapsPlaceReviews.handle(
        {
          url: params.url,
          count: params.count,
        },
        {
          signal: context.signal,
        },
      );
    },
  });
}
