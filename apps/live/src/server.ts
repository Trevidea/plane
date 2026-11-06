import { Server as HttpServer } from "http";
import { type Hocuspocus } from "@hocuspocus/server";
import compression from "compression";
import cors from "cors";
import express, { Express, Request, Response, Router } from "express";
import expressWs from "express-ws";
import helmet from "helmet";
// plane imports
import { registerController } from "@plane/decorators";

// controllers
import { CONTROLLERS } from "@/controllers";
// env
import { env } from "@/env";
// hocuspocus server
import { HocusPocusServerManager } from "@/hocuspocus";
// diagnostics
import { legacyLiveLog, diagnostic, diagnosticRequest } from "@/lib/diagnostics";
// redis
import { redisManager } from "@/redis";

export class Server {
  private app: Express;
  private router: Router;
  private hocuspocusServer: Hocuspocus | undefined;
  private httpServer: HttpServer | undefined;

  constructor() {
    this.app = express();
    expressWs(this.app);
    this.setupMiddleware();
    this.router = express.Router();
    this.app.set("port", env.PORT || 3000);
    this.app.use(env.LIVE_BASE_PATH, this.router);
  }

  public async initialize(): Promise<void> {
    diagnostic("service.starting");
    try {
      await redisManager.initialize();
      legacyLiveLog("info", "LIVE_193831DC4F2D", "SERVER: Redis setup completed");
      const manager = HocusPocusServerManager.getInstance();
      this.hocuspocusServer = await manager.initialize();
      legacyLiveLog("info", "LIVE_1E7FC7426628", "SERVER: HocusPocus setup completed");
      this.setupRoutes(this.hocuspocusServer);
      this.setupNotFoundHandler();
    } catch (error) {
      diagnostic("service.startup.failed", { error_code: "INITIALIZATION_FAILED" }, "error");
      throw error;
    }
  }

  private setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    // Middleware for response compression
    this.app.use(compression({ level: env.COMPRESSION_LEVEL, threshold: env.COMPRESSION_THRESHOLD }));
    // Logging middleware
    this.app.use(diagnosticRequest);
    // Body parsing middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    // cors middleware
    this.setupCors();
  }

  private setupCors() {
    const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    this.app.use(
      cors({
        origin: allowedOrigins.length > 0 ? allowedOrigins : false,
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
      })
    );
  }

  private setupNotFoundHandler() {
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({
        message: "Not Found",
      });
    });
  }

  private setupRoutes(hocuspocusServer: Hocuspocus) {
    CONTROLLERS.forEach((controller) => registerController(this.router, controller, [hocuspocusServer]));
  }

  public listen() {
    this.httpServer = this.app
      .listen(this.app.get("port"), () => {
        diagnostic("service.ready");
        legacyLiveLog("info", "LIVE_3C1A65091443", `SERVER: Express server has started at port ${this.app.get("port")}`);
      })
      .on("error", (err) => {
        diagnostic("service.listener.failed", { error_code: "LISTENER_FAILED" }, "error");
        throw err;
      });
  }

  public async destroy() {
    diagnostic("service.stopping");
    if (this.hocuspocusServer) {
      this.hocuspocusServer.closeConnections();
      legacyLiveLog("info", "LIVE_0605821A2CB4", "SERVER: HocusPocus connections closed gracefully.");
    }

    await redisManager.disconnect();
    legacyLiveLog("info", "LIVE_8914C678D262", "SERVER: Redis connection closed gracefully.");

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) {
            reject(err);
          } else {
            legacyLiveLog("info", "LIVE_1CDE76285C80", "SERVER: Express server closed gracefully.");
            resolve();
          }
        });
      });
    }
  }
}
