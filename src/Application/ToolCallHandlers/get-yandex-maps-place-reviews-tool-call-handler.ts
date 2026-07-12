import type { Clock } from "../Dependencies/clock.js";
import type { AppLogger } from "../Dependencies/logger.js";
import type { YandexMapsReviewCollector } from "../Dependencies/yandex-maps-review-collector.js";
import type {
  GetYandexMapsPlaceReviewsInputDto,
  GetYandexMapsPlaceReviewsOutputDto,
} from "../Dtos/yandex-maps-place-reviews.dto.js";
import { normalizeYandexMapsPlaceReviewsInput } from "../Normalization/normalize-yandex-maps-place-reviews-input.js";

export class GetYandexMapsPlaceReviewsToolCallHandler {
  constructor(
    private readonly collector: YandexMapsReviewCollector,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  async handle(
    input: GetYandexMapsPlaceReviewsInputDto,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<GetYandexMapsPlaceReviewsOutputDto> {
    options?.signal?.throwIfAborted();

    const normalizedInput = normalizeYandexMapsPlaceReviewsInput(input);
    this.logger.info("Handling Yandex Maps reviews tool call.", {
      count: normalizedInput.count,
      headed: Boolean(normalizedInput.headed),
      requestedAt: this.clock.now().toISOString(),
    });

    return this.collector.collect(
      normalizedInput,
      {
        signal: options?.signal,
      },
    );
  }
}
