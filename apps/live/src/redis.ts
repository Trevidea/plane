import Redis from "ioredis";

import { legacyLiveLog } from "@/lib/diagnostics";
import { env } from "./env";
import { diagnostic, diagnosticCall } from "./lib/diagnostics";

export class RedisManager {
  private static instance: RedisManager;
  private redisClient: Redis | null = null;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  private constructor() {}

  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  public async initialize(): Promise<void> {
    if (this.redisClient && this.isConnected) {
      legacyLiveLog("info", "LIVE_12362C6364DC", "REDIS_MANAGER: client already initialized and connected");
      return;
    }

    if (this.connectionPromise) {
      legacyLiveLog("info", "LIVE_2F94E47CC9B0", "REDIS_MANAGER: Redis connection already in progress, waiting...");
      await this.connectionPromise;
      return;
    }

    this.connectionPromise = this.connect();
    await this.connectionPromise;
  }

  private getRedisUrl(): string {
    const redisUrl = env.REDIS_URL;
    const redisHost = env.REDIS_HOST;
    const redisPort = env.REDIS_PORT;

    if (redisUrl) {
      return redisUrl;
    }

    if (redisHost && redisPort && !Number.isNaN(Number(redisPort))) {
      return `redis://${redisHost}:${redisPort}`;
    }

    return "";
  }

  private async connect(): Promise<void> {
    try {
      const redisUrl = this.getRedisUrl();

      if (!redisUrl) {
        legacyLiveLog("warn", "LIVE_34633FC0BE9A", "REDIS_MANAGER: No Redis URL provided, Redis functionality will be disabled");
        this.isConnected = false;
        return;
      }

      // Configuration optimized for BOTH regular operations AND pub/sub
      // HocuspocusRedis uses .duplicate() which inherits these settings
      this.redisClient = new Redis(redisUrl, {
        lazyConnect: false, // Connect immediately for reliability (duplicates inherit this)
        keepAlive: 30000,
        connectTimeout: 10000,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true, // Keep commands queued during reconnection
        retryStrategy: (times: number) => {
          // Exponential backoff with max 2 seconds
          const delay = Math.min(times * 50, 2000);
          diagnostic("cache.connection.retry", { dependency: "redis", attempt: times });
          legacyLiveLog("info", "LIVE_174E3E09DDB5", `REDIS_MANAGER: Reconnection attempt ${times}, delay: ${delay}ms`);
          return delay;
        },
      });

      // Set up event listeners
      this.redisClient.on("connect", () => {
        legacyLiveLog("info", "LIVE_149E669EFD49", "REDIS_MANAGER: Redis client connected");
        this.isConnected = true;
      });

      this.redisClient.on("ready", () => {
        diagnostic("cache.connection.ready", { dependency: "redis" });
        legacyLiveLog("info", "LIVE_33CACB768C7C", "REDIS_MANAGER: Redis client ready");
        this.isConnected = true;
      });

      this.redisClient.on("error", () => {
        diagnostic("cache.connection.failed", { dependency: "redis", error_code: "REDIS_CONNECTION_FAILED" }, "error");
        this.isConnected = false;
      });

      this.redisClient.on("close", () => {
        diagnostic("cache.connection.closed", { dependency: "redis" });
        legacyLiveLog("warn", "LIVE_92D1606C7CF1", "REDIS_MANAGER: Redis client connection closed");
        this.isConnected = false;
      });

      this.redisClient.on("reconnecting", () => {
        legacyLiveLog("info", "LIVE_820E051A9157", "REDIS_MANAGER: Redis client reconnecting...");
        this.isConnected = false;
      });

      await this.redisClient.ping();
      legacyLiveLog("info", "LIVE_70FDF5EAA0D9", "REDIS_MANAGER: Redis connection test successful");
    } catch (error) {
      diagnostic("cache.initialization.failed", { error_code: "REDIS_INITIALIZATION_FAILED" }, "error");
      this.isConnected = false;
      throw error;
    } finally {
      this.connectionPromise = null;
    }
  }

  public getClient(): Redis | null {
    if (!this.redisClient || !this.isConnected) {
      legacyLiveLog("warn", "LIVE_9655BB3E37E2", "REDIS_MANAGER: Redis client not available or not connected");
      return null;
    }
    return this.redisClient;
  }

  public isClientConnected(): boolean {
    return this.isConnected && this.redisClient !== null;
  }

  public async disconnect(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
        legacyLiveLog("info", "LIVE_4963798F9AE9", "REDIS_MANAGER: Redis client disconnected gracefully");
      } catch {
        diagnostic("cache.disconnect.failed", { error_code: "REDIS_DISCONNECT_FAILED" }, "error");
        // Force disconnect if quit fails
        this.redisClient.disconnect();
      } finally {
        this.redisClient = null;
        this.isConnected = false;
      }
    }
  }

  // Convenience methods for common Redis operations
  public async set(key: string, value: string, ttl?: number): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      if (ttl) {
        await diagnosticCall(() => client.setex(key, ttl, value), "setex");
      } else {
        await diagnosticCall(() => client.set(key, value), "set");
      }
      return true;
    } catch {
      return false;
    }
  }

  public async get(key: string): Promise<string | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      return await diagnosticCall(() => client.get(key), "get");
    } catch {
      return null;
    }
  }

  public async del(key: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      await diagnosticCall(() => client.del(key), "delete");
      return true;
    } catch {
      return false;
    }
  }

  public async exists(key: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      const result = await diagnosticCall(() => client.exists(key), "exists");
      return result === 1;
    } catch {
      return false;
    }
  }

  public async expire(key: string, ttl: number): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      const result = await diagnosticCall(() => client.expire(key, ttl), "expire");
      return result === 1;
    } catch {
      return false;
    }
  }
}

// Export a default instance for convenience
export const redisManager = RedisManager.getInstance();
