import { Type } from "typebox";

export const logLevelSchema = Type.Optional(
  Type.Union([
    Type.Literal("silent"),
    Type.Literal("error"),
    Type.Literal("warn"),
    Type.Literal("info"),
    Type.Literal("debug"),
  ]),
);

export const yandexMapsPlaceReviewsConfigSchema = Type.Object(
  {
    logLevel: logLevelSchema,
  },
  { additionalProperties: false },
);
