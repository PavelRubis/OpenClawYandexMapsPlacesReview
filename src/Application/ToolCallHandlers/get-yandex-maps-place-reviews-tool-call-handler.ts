import { normalizeReviewCount } from "../../count.js";
import type { Clock } from "../Dependencies/clock.js";
import type { AppLogger } from "../Dependencies/logger.js";
import type { YandexMapsReviewCollector } from "../Dependencies/yandex-maps-review-collector.js";
import type {
  GetYandexMapsPlaceReviewsInputDto,
  GetYandexMapsPlaceReviewsOutputDto,
} from "../Dtos/yandex-maps-place-reviews.dto.js";

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

    if (!input.url.trim()) {
      throw new Error("url must not be empty.");
    }

    const count = normalizeReviewCount(input.count);
    this.logger.info("Handling Yandex Maps reviews tool call.", {
      count,
      headed: Boolean(input.headed),
      requestedAt: this.clock.now().toISOString(),
    });

    return this.collector.collect(
      {
        ...input,
        count,
      },
      {
        signal: options?.signal,
      },
    );
  }
}
