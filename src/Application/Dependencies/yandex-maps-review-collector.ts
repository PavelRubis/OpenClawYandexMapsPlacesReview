import type {
  CollectYandexMapsPlaceReviewsInputDto,
  GetYandexMapsPlaceReviewsOutputDto,
} from "../Dtos/yandex-maps-place-reviews.dto.js";

export interface YandexMapsReviewCollector {
  collect(
    input: CollectYandexMapsPlaceReviewsInputDto,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<GetYandexMapsPlaceReviewsOutputDto>;
}
