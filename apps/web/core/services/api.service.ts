/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AxiosInstance, AxiosRequestConfig } from "axios";
import axios from "axios";
import { beginWorkflow, failWorkflow } from "@/helpers/workflow-diagnostics";
import type { WorkflowOperation } from "@/helpers/workflow-diagnostics";

export abstract class APIService {
  protected baseURL: string;
  private axiosInstance: AxiosInstance;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.axiosInstance = axios.create({
      baseURL,
      withCredentials: true,
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    const operations = new WeakMap<object, WorkflowOperation>();
    this.axiosInstance.interceptors.request.use((config) => {
      const match = config.url?.match(
        /^\/api\/workspaces\/([^/]+)\/projects\/([^/]+)\/(?:coaching-cards\/|issues\/create-coaching-cards\/)/
      );
      if (match && ["post", "patch", "put", "delete"].includes(config.method || "")) {
        const operation = beginWorkflow(match[1], match[2], "coaching-card");
        if (operation) {
          operations.set(config, operation);
          Object.entries(operation.headers).forEach(([name, value]) => config.headers.set(name, value));
        }
      }
      return config;
    });
    this.axiosInstance.interceptors.response.use(
      (response) => {
        operations.get(response.config)?.complete();
        operations.delete(response.config);
        return response;
      },
      (error) => {
        if (error.config) {
          failWorkflow(operations.get(error.config) || null, error);
          operations.delete(error.config);
        }
        if (error.response && error.response.status === 401) {
          const currentPath = window.location.pathname;
          window.location.replace(`/${currentPath ? `?next_path=${currentPath}` : ``}`);
        }
        return Promise.reject(error);
      }
    );
  }

  get(url: string, params = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.get(url, {
      ...params,
      ...config,
    });
  }

  post(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.post(url, data, config);
  }

  put(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.put(url, data, config);
  }

  patch(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.patch(url, data, config);
  }

  delete(url: string, data?: any, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.delete(url, { data, ...config });
  }

  request(config = {}) {
    return this.axiosInstance(config);
  }
}
