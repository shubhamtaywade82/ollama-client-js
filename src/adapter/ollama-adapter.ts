import { Ollama } from 'ollama';
import type {
  AbortableAsyncIterator,
  ChatRequest,
  ChatResponse,
  CopyRequest,
  CreateRequest,
  DeleteRequest,
  EmbedRequest,
  EmbedResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  GenerateRequest,
  GenerateResponse,
  ListResponse,
  ProgressResponse,
  PullRequest,
  PushRequest,
  ShowRequest,
  ShowResponse,
  StatusResponse,
  VersionResponse,
} from 'ollama';
import { mapError } from '../errors.js';
import type { OllamaErrorRequestContext } from '../errors.js';
import type { FetchLike } from '../transport/enhanced-fetch.js';

export interface OllamaAdapterConfig {
  readonly host: string;
  readonly fetch: FetchLike;
  readonly headers?: Record<string, string>;
}

/**
 * Isolates every interaction with the upstream `ollama` package behind a
 * single, narrow surface. Nothing outside this file imports from `ollama`
 * directly, so upgrading or replacing the upstream dependency only ever
 * touches this adapter.
 *
 * Every method catches whatever the upstream client throws (its own
 * `ResponseError`, a raw network `TypeError`, an `AbortError`) and re-throws
 * it as one of this package's structured {@link OllamaClientError} subtypes.
 */
export class OllamaAdapter {
  private readonly upstream: Ollama;

  constructor(config: OllamaAdapterConfig) {
    this.upstream = new Ollama({
      host: config.host,
      fetch: config.fetch,
      headers: config.headers,
    });
  }

  private context(
    endpoint: string,
    extra: Partial<OllamaErrorRequestContext> = {},
  ): OllamaErrorRequestContext {
    return { endpoint, method: 'POST', ...extra };
  }

  async chat(
    request: ChatRequest & { stream: true },
  ): Promise<AbortableAsyncIterator<ChatResponse>>;
  async chat(request: ChatRequest & { stream?: false }): Promise<ChatResponse>;
  async chat(request: ChatRequest): Promise<ChatResponse | AbortableAsyncIterator<ChatResponse>> {
    try {
      if (request.stream) {
        return await this.upstream.chat({ ...request, stream: true });
      }
      return await this.upstream.chat({ ...request, stream: false });
    } catch (error) {
      throw mapError(error, {
        request: this.context('/api/chat', { model: request.model, stream: request.stream }),
      });
    }
  }

  async generate(
    request: GenerateRequest & { stream: true },
  ): Promise<AbortableAsyncIterator<GenerateResponse>>;
  async generate(request: GenerateRequest & { stream?: false }): Promise<GenerateResponse>;
  async generate(
    request: GenerateRequest,
  ): Promise<GenerateResponse | AbortableAsyncIterator<GenerateResponse>> {
    try {
      if (request.stream) {
        return await this.upstream.generate({ ...request, stream: true });
      }
      return await this.upstream.generate({ ...request, stream: false });
    } catch (error) {
      throw mapError(error, {
        request: this.context('/api/generate', { model: request.model, stream: request.stream }),
      });
    }
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    try {
      return await this.upstream.embed(request);
    } catch (error) {
      throw mapError(error, { request: this.context('/api/embed', { model: request.model }) });
    }
  }

  async embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    try {
      return await this.upstream.embeddings(request);
    } catch (error) {
      throw mapError(error, {
        request: this.context('/api/embeddings', { model: request.model }),
      });
    }
  }

  async list(): Promise<ListResponse> {
    try {
      return await this.upstream.list();
    } catch (error) {
      throw mapError(error, { request: this.context('/api/tags', { method: 'GET' }) });
    }
  }

  async show(request: ShowRequest): Promise<ShowResponse> {
    try {
      return await this.upstream.show(request);
    } catch (error) {
      throw mapError(error, { request: this.context('/api/show', { model: request.model }) });
    }
  }

  async pull(
    request: PullRequest & { stream: true },
  ): Promise<AbortableAsyncIterator<ProgressResponse>>;
  async pull(request: PullRequest & { stream?: false }): Promise<ProgressResponse>;
  async pull(
    request: PullRequest,
  ): Promise<ProgressResponse | AbortableAsyncIterator<ProgressResponse>> {
    try {
      if (request.stream) {
        return await this.upstream.pull({ ...request, stream: true });
      }
      return await this.upstream.pull({ ...request, stream: false });
    } catch (error) {
      throw mapError(error, {
        request: this.context('/api/pull', { model: request.model, stream: request.stream }),
      });
    }
  }

  async push(
    request: PushRequest & { stream: true },
  ): Promise<AbortableAsyncIterator<ProgressResponse>>;
  async push(request: PushRequest & { stream?: false }): Promise<ProgressResponse>;
  async push(
    request: PushRequest,
  ): Promise<ProgressResponse | AbortableAsyncIterator<ProgressResponse>> {
    try {
      if (request.stream) {
        return await this.upstream.push({ ...request, stream: true });
      }
      return await this.upstream.push({ ...request, stream: false });
    } catch (error) {
      throw mapError(error, {
        request: this.context('/api/push', { model: request.model, stream: request.stream }),
      });
    }
  }

  async create(
    request: CreateRequest & { stream: true },
  ): Promise<AbortableAsyncIterator<ProgressResponse>>;
  async create(request: CreateRequest & { stream?: false }): Promise<ProgressResponse>;
  async create(
    request: CreateRequest,
  ): Promise<ProgressResponse | AbortableAsyncIterator<ProgressResponse>> {
    try {
      if (request.stream) {
        return await this.upstream.create({ ...request, stream: true });
      }
      return await this.upstream.create({ ...request, stream: false });
    } catch (error) {
      throw mapError(error, {
        request: this.context('/api/create', { model: request.model, stream: request.stream }),
      });
    }
  }

  async delete(request: DeleteRequest): Promise<StatusResponse> {
    try {
      return await this.upstream.delete(request);
    } catch (error) {
      throw mapError(error, {
        request: this.context('/api/delete', { method: 'DELETE', model: request.model }),
      });
    }
  }

  async copy(request: CopyRequest): Promise<StatusResponse> {
    try {
      return await this.upstream.copy(request);
    } catch (error) {
      throw mapError(error, { request: this.context('/api/copy') });
    }
  }

  async ps(): Promise<ListResponse> {
    try {
      return await this.upstream.ps();
    } catch (error) {
      throw mapError(error, { request: this.context('/api/ps', { method: 'GET' }) });
    }
  }

  async version(): Promise<VersionResponse> {
    try {
      return await this.upstream.version();
    } catch (error) {
      throw mapError(error, { request: this.context('/api/version', { method: 'GET' }) });
    }
  }

  /** Aborts every in-flight streamed request created through this adapter's upstream client. */
  abortAll(): void {
    this.upstream.abort();
  }
}
