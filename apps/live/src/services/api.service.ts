import axios, { AxiosInstance } from "axios";
import { env } from "@/env";
import { diagnostic, diagnosticHeaders } from "@/lib/diagnostics";
import { AppError } from "@/lib/errors";

export abstract class APIService {
  protected baseURL: string;
  private axiosInstance: AxiosInstance;
  private header: Record<string, string> = {};

  constructor(baseURL?: string) {
    this.baseURL = baseURL || env.API_BASE_URL;
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      withCredentials: true,
      timeout: 20000,
    });
    this.setupInterceptors();
  }

  private setupInterceptors() {
    const started = new WeakMap<object, number>();
    this.axiosInstance.interceptors.request.use((config) => {
      try {
        started.set(config, performance.now());
        if (new URL(config.url || "", config.baseURL).origin === new URL(env.API_BASE_URL).origin) {
          for (const [key, value] of Object.entries(diagnosticHeaders()))
            if (!config.headers.has(key)) config.headers.set(key, value);
        }
      } catch {
        /* Preserve all existing authentication and request semantics. */
      }
      return config;
    });
    const observe = (config: object | undefined, status: number | undefined, failed = false) => {
      const start = config ? started.get(config) : undefined;
      if (start !== undefined) {
        const elapsed = performance.now() - start;
        diagnostic(
          "api.upstream.completed",
          { dependency: "plane-api", status_code: status, ...(failed ? { error_code: "API_UPSTREAM_FAILED" } : {}) },
          failed ? "error" : "ok",
          elapsed,
          elapsed < 500
        );
      }
    };
    this.axiosInstance.interceptors.response.use(
      (response) => {
        observe(response.config, response.status);
        return response;
      },
      (error) => {
        if (axios.isAxiosError(error)) observe(error.config, error.response?.status, true);
        return Promise.reject(new AppError(error));
      }
    );
  }

  setHeader(key: string, value: string) {
    this.header[key] = value;
  }

  getHeader() {
    return this.header;
  }

  get(url: string, params = {}, config = {}) {
    return this.axiosInstance.get(url, {
      ...params,
      ...config,
    });
  }

  post(url: string, data = {}, config = {}) {
    return this.axiosInstance.post(url, data, config);
  }

  put(url: string, data = {}, config = {}) {
    return this.axiosInstance.put(url, data, config);
  }

  patch(url: string, data = {}, config = {}) {
    return this.axiosInstance.patch(url, data, config);
  }

  delete(url: string, data?: Record<string, unknown> | null | string, config = {}) {
    return this.axiosInstance.delete(url, { data, ...config });
  }

  request(config = {}) {
    return this.axiosInstance(config);
  }
}
