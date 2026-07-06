import type {
  GetYandexMapsPlaceReviewsInputDto,
  GetYandexMapsPlaceReviewsOutputDto,
} from "../Dtos/yandex-maps-place-reviews.dto.js";

export interface YandexMapsReviewCollector {
  collect(
    input: GetYandexMapsPlaceReviewsInputDto,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<GetYandexMapsPlaceReviewsOutputDto>;
}
