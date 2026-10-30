import { Logger as HocuspocusLogger } from "@hocuspocus/extension-logger";

import { legacyLiveLog } from "@/lib/diagnostics";

export class Logger extends HocuspocusLogger {
  constructor() {
    super({
      onChange: false,
      log: (message) => {
        legacyLiveLog("info", "LIVE_A6B0017431F1", message);
      },
    });
  }
}
