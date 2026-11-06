// types

import type { IUser } from "@plane/types";
import { legacyLiveLog } from "@/lib/diagnostics";
// services
import { AppError } from "@/lib/errors";
import { APIService } from "@/services/api.service";

export class UserService extends APIService {
  constructor() {
    super();
  }

  currentUserConfig() {
    return {
      url: `${this.baseURL}/api/users/me/`,
    };
  }

  async currentUser(cookie: string): Promise<IUser> {
    return this.get("/api/users/me/", {
      headers: {
        Cookie: cookie,
      },
    })
      .then((response) => response?.data)
      .catch((error) => {
        const appError = new AppError(error, {
          context: { operation: "currentUser" },
        });
        legacyLiveLog("error", "LIVE_6B09D9621A4E", "Failed to fetch current user", appError);
        throw appError;
      });
  }
}
