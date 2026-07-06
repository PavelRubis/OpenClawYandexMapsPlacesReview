import { Type } from "typebox";
import { DEFAULT_REVIEW_COUNT, MAX_REVIEW_COUNT, MIN_REVIEW_COUNT } from "../Application/Dtos/yandex-maps-place-reviews.dto.js";

export const yandexMapsPlaceReviewsParametersSchema = Type.Object(
  {
    url: Type.String({
      description: "Yandex Maps place URL.",
    }),
    count: Type.Optional(
      Type.Number({
        description: `Number of latest reviews to return. Defaults to ${DEFAULT_REVIEW_COUNT}.`,
        minimum: MIN_REVIEW_COUNT,
        maximum: MAX_REVIEW_COUNT,
      }),
    ),
  },
  { additionalProperties: false },
);
