
import { TPage } from "@plane/types";
import { legacyLiveLog } from "@/lib/diagnostics";
// services
import { AppError } from "@/lib/errors";
import { APIService } from "../api.service";

export type TPageDescriptionPayload = {
  description_binary: string;
  description_html: string;
  description: object;
};

export abstract class PageCoreService extends APIService {
  protected abstract basePath: string;

  constructor() {
    super();
  }

  async fetchDetails(pageId: string): Promise<TPage> {
    return this.get(`${this.basePath}/pages/${pageId}/`, {
      headers: this.getHeader(),
    })
      .then((response) => response?.data)
      .catch((error) => {
        const appError = new AppError(error, {
          context: { operation: "fetchDetails", pageId },
        });
        legacyLiveLog("error", "LIVE_328D1B4E783C", "Failed to fetch page details", appError);
        throw appError;
      });
  }

  async fetchDescriptionBinary(pageId: string): Promise<any> {
    return this.get(`${this.basePath}/pages/${pageId}/description/`, {
      headers: {
        ...this.getHeader(),
        "Content-Type": "application/octet-stream",
      },
      responseType: "arraybuffer",
    })
      .then((response) => response?.data)
      .catch((error) => {
        const appError = new AppError(error, {
          context: { operation: "fetchDescriptionBinary", pageId },
        });
        legacyLiveLog("error", "LIVE_97A77671FB07", "Failed to fetch page description binary", appError);
        throw appError;
      });
  }

  /**
   * Updates the title of a page
   */
  async updatePageProperties(
    pageId: string,
    params: { data: Partial<TPage>; abortSignal?: AbortSignal }
  ): Promise<TPage> {
    const { data, abortSignal } = params;

    // Early abort check
    if (abortSignal?.aborted) {
      throw new AppError(new DOMException("Aborted", "AbortError"));
    }

    // Create an abort listener that will reject the pending promise
    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise((_, reject) => {
      if (abortSignal) {
        abortListener = () => {
          reject(new AppError(new DOMException("Aborted", "AbortError")));
        };
        abortSignal.addEventListener("abort", abortListener);
      }
    });

    try {
      return await Promise.race([
        this.patch(`${this.basePath}/pages/${pageId}/`, data, {
          headers: this.getHeader(),
          signal: abortSignal,
        })
          .then((response) => response?.data)
          .catch((error) => {
            const appError = new AppError(error, {
              context: { operation: "updatePageProperties", pageId },
            });

            if (appError.code === "ABORT_ERROR") {
              throw appError;
            }

            legacyLiveLog("error", "LIVE_4BF1F4800132", "Failed to update page properties", appError);
            throw appError;
          }),
        abortPromise,
      ]);
    } finally {
      // Clean up abort listener
      if (abortSignal && abortListener) {
        abortSignal.removeEventListener("abort", abortListener);
      }
    }
  }

  async updateDescriptionBinary(pageId: string, data: TPageDescriptionPayload): Promise<any> {
    return this.patch(`${this.basePath}/pages/${pageId}/description/`, data, {
      headers: this.getHeader(),
    })
      .then((response) => response?.data)
      .catch((error) => {
        const appError = new AppError(error, {
          context: { operation: "updateDescriptionBinary", pageId },
        });
        legacyLiveLog("error", "LIVE_F1E07EB1C8FB", "Failed to update page description binary", appError);
        throw appError;
      });
  }
}
