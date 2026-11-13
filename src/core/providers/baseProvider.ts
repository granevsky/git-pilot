import type { SettingsManager, SourceOfTruth } from '../config/settings';
import type { Logger } from '../logger';
import type { EntityRef, GitPlatformProvider, Platform, SyncState, User } from '../types';

// ---------------------------------------------------------------------------
// Scoped label engine (pure functions — identical behaviour on GitHub, GitLab CE and EE)
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `"status::"`, `"status:"`, `"status: "` → `"status"`. */
export function statusPrefixBase(prefix: string): string {
  return prefix.trim().replace(/:+\s*$/, '').trim();
}

function statusLabelRegex(prefix: string): RegExp {
  const base = statusPrefixBase(prefix);
  // If the prefix has no colon at all (e.g. "status-"), match it literally.
  if (!/:\s*$/.test(prefix.trim())) {
    return new RegExp(`^\\s*${escapeRegExp(prefix.trim())}`, 'i');
  }
  return new RegExp(`^\\s*${escapeRegExp(base)}\\s*::?\\s*`, 'i');
}

/** True when `label` is a status label for `prefix`, treating `:` and `::` (and whitespace) as equivalent. */
export function isStatusLabel(label: string, prefix: string): boolean {
  return statusLabelRegex(prefix).test(label);
}

export function findStatusLabel(labels: readonly string[], prefix: string): string | null {
  return labels.find((l) => isStatusLabel(l, prefix)) ?? null;
}

/** Strips the prefix for compact display: `"status::qa-passed"` → `"qa-passed"`. */
export function statusValue(label: string, prefix: string): string {
  return label.replace(statusLabelRegex(prefix), '').trim() || label;
}

export function sameStatus(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/**
 * Client-side emulation of mutually-exclusive scoped labels: removes every
 * existing status label (any `:`/`::` variant) while keeping unrelated labels,
 * then appends `newStatusLabel`.
 */
export function computeUpdatedLabels(currentLabels: readonly string[], newStatusLabel: string, prefix: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const label of currentLabels) {
    const key = label.toLowerCase();
    if (!isStatusLabel(label, prefix) && !seen.has(key)) {
      seen.add(key);
      result.push(label);
    }
  }
  const next = newStatusLabel.trim();
  if (next && !seen.has(next.toLowerCase())) {
    result.push(next);
  }
  return result;
}

export function sameLabelSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a.map((l) => l.toLowerCase()));
  return b.every((l) => set.has(l.toLowerCase()));
}

/**
 * Decides which status should win when the Issue and MR side diverge.
 * Returns `null` when there is a genuine conflict in `prompt` mode or no status exists anywhere.
 * A side without any status label never "wins" against one that has a status — gaps are filled.
 */
export function resolveEffectiveStatus(issueStatus: string | null, mrStatus: string | null, mode: SourceOfTruth): string | null {
  switch (mode) {
    case 'mr':
      return mrStatus ?? issueStatus;
    case 'issue':
      return issueStatus ?? mrStatus;
    case 'prompt':
      if (issueStatus && mrStatus && !sameStatus(issueStatus, mrStatus)) {
        return null;
      }
      return issueStatus ?? mrStatus;
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ProviderErrorKind =
  | 'auth'
  | 'forbidden'
  | 'notFound'
  | 'rateLimit'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalidResponse'
  | 'insecure';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function isProviderError(err: unknown, kind?: ProviderErrorKind): err is ProviderError {
  return err instanceof ProviderError && (kind === undefined || err.kind === kind);
}

// ---------------------------------------------------------------------------
// Base provider
// ---------------------------------------------------------------------------

export interface ProviderOptions {
  /** Token key host, `hostname[:port]`. */
  host: string;
  /** Web base URL without trailing slash, e.g. `https://gitlab.company.com`. */
  webBaseUrl: string;
  projectPath: string;
  token: string;
  settings: SettingsManager;
  logger: Logger;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface HttpResponse<T> {
  data: T;
  headers: Headers;
  status: number;
}

export type EntityKind = 'issue' | 'mr';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_PAGES = 10;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export abstract class BaseProvider implements GitPlatformProvider {
  abstract readonly platform: Platform;
  protected abstract readonly apiBaseUrl: string;

  readonly host: string;
  readonly webBaseUrl: string;
  readonly projectPath: string;
  protected readonly token: string;
  protected readonly settings: SettingsManager;
  protected readonly logger: Logger;

  constructor(opts: ProviderOptions) {
    this.host = opts.host;
    this.webBaseUrl = opts.webBaseUrl.replace(/\/+$/, '');
    this.projectPath = opts.projectPath;
    this.token = opts.token;
    this.settings = opts.settings;
    this.logger = opts.logger;
  }

  // ----- abstract platform surface -----------------------------------------

  abstract getCurrentUser(): Promise<User>;
  abstract getSyncState(issueNumber: number, branchName: string): Promise<SyncState | null>;
  protected abstract authHeaders(): Record<string, string>;
  /** Persists `nextLabels` on the entity; returns the labels as reported by the server. */
  protected abstract writeLabels(entity: EntityRef, kind: EntityKind, currentLabels: string[], nextLabels: string[]): Promise<string[]>;

  // ----- shared status logic -----------------------------------------------

  protected get labelPrefix(): string {
    return this.settings.statusSync.labelPrefix;
  }

  protected toStatus(labels: string[]): string | null {
    return findStatusLabel(labels, this.labelPrefix);
  }

  protected filterStatusLabels(labels: string[]): string[] {
    const seen = new Set<string>();
    return labels.filter((l) => {
      const key = l.toLowerCase();
      if (!isStatusLabel(l, this.labelPrefix) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /** Assembles a SyncState, sorting MRs newest-first and computing `isSynced` / `effectiveStatus`. */
  protected buildSyncState(issue: EntityRef, mergeRequests: EntityRef[], availableStatusLabels: string[]): SyncState {
    const mrs = [...mergeRequests].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const all = [issue, ...mrs];
    const isSynced = all.every((e) => sameStatus(e.statusLabel, issue.statusLabel));
    // The MR side is represented by the most recently updated open MR that carries a status.
    const mrStatus = mrs.find((m) => m.statusLabel)?.statusLabel ?? null;
    const effectiveStatus = isSynced
      ? issue.statusLabel
      : resolveEffectiveStatus(issue.statusLabel, mrStatus, this.settings.statusSync.sourceOfTruth);

    return {
      platform: this.platform,
      host: this.host,
      projectPath: this.projectPath,
      issue,
      mergeRequests: mrs,
      availableStatusLabels,
      isSynced,
      effectiveStatus,
    };
  }

  /** Applies `newStatusLabel` to the issue and every open MR/PR in parallel, skipping no-op writes. */
  async setUnifiedStatus(state: SyncState, newStatusLabel: string): Promise<SyncState> {
    const prefix = this.labelPrefix;
    const apply = async (entity: EntityRef, kind: EntityKind): Promise<EntityRef> => {
      const next = computeUpdatedLabels(entity.allLabels, newStatusLabel, prefix);
      if (sameLabelSet(next, entity.allLabels)) {
        return entity;
      }
      // IDs are interpolated into API paths; never trust their runtime type.
      if (!Number.isSafeInteger(entity.id) || entity.id <= 0) {
        throw new ProviderError(`Invalid ${kind} id from server: ${String(entity.id)}`, 'invalidResponse');
      }
      const ref = kind === 'issue' ? `issue #${entity.id}` : `MR/PR ${entity.id}`;
      this.logger.info(`[${this.platform}] ${ref}: ${entity.statusLabel ?? '(none)'} -> ${newStatusLabel}`);
      const labels = await this.writeLabels(entity, kind, entity.allLabels, next);
      // `updatedAt` is intentionally kept so the "latest MR" ordering stays stable.
      return { ...entity, allLabels: labels, statusLabel: findStatusLabel(labels, prefix) };
    };

    const [issue, ...mrs] = await Promise.all([
      apply(state.issue, 'issue'),
      ...state.mergeRequests.map((mr) => apply(mr, 'mr')),
    ]);

    const available = state.availableStatusLabels.some((l) => sameStatus(l, newStatusLabel))
      ? state.availableStatusLabels
      : [...state.availableStatusLabels, newStatusLabel];
    return this.buildSyncState(issue, mrs, available);
  }

  // ----- HTTP client ---------------------------------------------------------

  protected buildUrl(pathOrUrl: string, query?: Record<string, QueryValue>): string {
    const url = new URL(/^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${this.apiBaseUrl}${pathOrUrl}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** Origins the token may be sent to. Anything else (Link headers, redirects, absolute URLs) is refused. */
  protected allowedOrigins(): string[] {
    return [new URL(this.apiBaseUrl).origin];
  }

  /** Security gate in front of every credentialed request. */
  private assertSafeUrl(url: URL): void {
    if (url.username || url.password) {
      throw new ProviderError('Refusing request: URL contains embedded credentials', 'insecure');
    }
    if (!this.allowedOrigins().includes(url.origin)) {
      throw new ProviderError(`Refusing to send the ${this.host} token to ${url.origin}`, 'insecure');
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && this.settings.allowInsecureHttp)) {
      throw new ProviderError(
        `Refusing to send the token over insecure ${url.protocol.replace(':', '')} to ${url.host}. Use HTTPS, or enable "gitPilot.allowInsecureHttp" in your user settings.`,
        'insecure',
      );
    }
  }

  /**
   * Returns `raw` only if it is an http(s) link on this instance's web host; otherwise a safe
   * fallback. Prevents server-supplied `command:`/`vscode:`/foreign links from reaching
   * tooltips or `openExternal`.
   */
  protected safeWebUrl(raw: unknown, fallbackPath: string): string {
    const base = new URL(this.webBaseUrl);
    if (typeof raw === 'string') {
      try {
        const url = new URL(raw);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && url.host === base.host && !url.username && !url.password) {
          // Parentheses would break Markdown link syntax in tooltips.
          return url.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
        }
      } catch {
        // fall through
      }
    }
    return `${this.webBaseUrl}/${fallbackPath}`;
  }

  protected async request<T>(method: string, pathOrUrl: string, opts: RequestOptions = {}): Promise<HttpResponse<T>> {
    const url = this.buildUrl(pathOrUrl, opts.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'git-pilot-vscode',
      ...this.authHeaders(),
      ...opts.headers,
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const started = Date.now();
    const signal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let current = new URL(url);
    let res: Response;

    // Redirects are followed manually: fetch would forward custom auth headers such as
    // GitLab's PRIVATE-TOKEN to any host a redirect points to.
    for (let hop = 0; ; hop++) {
      this.assertSafeUrl(current);
      try {
        res = await fetch(current, { method, headers, body, signal, redirect: 'manual' });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new ProviderError(`Request to ${this.host} timed out`, 'timeout');
        }
        const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : '';
        throw new ProviderError(`Cannot reach ${this.host}${cause}`, 'network');
      }
      this.logger.trace(`${method} ${redact(current.href)} -> ${res.status} (${Date.now() - started}ms)`);

      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) {
        break;
      }
      await res.body?.cancel().catch(() => undefined);
      if (hop >= MAX_REDIRECTS) {
        throw new ProviderError(`Too many redirects from ${this.host}`, 'http', res.status);
      }
      // Never silently turn a write into a GET (301/302/303 on non-GET).
      if (method !== 'GET' && res.status !== 307 && res.status !== 308) {
        throw new ProviderError(`Unexpected redirect (${res.status}) on ${method} to ${this.host}`, 'http', res.status);
      }
      current = new URL(location, current); // validated by assertSafeUrl on the next iteration
    }

    if (!res.ok) {
      throw await this.toError(res);
    }
    if (res.status === 204) {
      return { data: undefined as T, headers: res.headers, status: res.status };
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_RESPONSE_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      throw new ProviderError(`Response from ${this.host} is too large`, 'invalidResponse', res.status);
    }
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ProviderError(`Response from ${this.host} is too large`, 'invalidResponse', res.status);
    }
    try {
      return { data: (text ? JSON.parse(text) : undefined) as T, headers: res.headers, status: res.status };
    } catch {
      throw new ProviderError(`Unexpected non-JSON response from ${this.host}`, 'invalidResponse', res.status);
    }
  }

  protected async get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return (await this.request<T>('GET', path, { query })).data;
  }

  /** Follows RFC 5988 `Link: <…>; rel="next"` headers (supported by GitHub and GitLab). */
  protected async paginate<T>(path: string, query?: Record<string, QueryValue>, maxPages = MAX_PAGES): Promise<T[]> {
    const items: T[] = [];
    let next: string | null = this.buildUrl(path, query);
    for (let page = 0; next && page < maxPages; page++) {
      const res: HttpResponse<T[]> = await this.request<T[]>('GET', next);
      if (Array.isArray(res.data)) {
        items.push(...res.data);
      }
      next = parseNextLink(res.headers.get('link'));
    }
    return items;
  }

  private async toError(res: Response): Promise<ProviderError> {
    let detail = '';
    try {
      const text = await res.text();
      const json = JSON.parse(text) as { message?: unknown; error?: unknown; error_description?: unknown };
      const msg = json.message ?? json.error_description ?? json.error;
      detail = typeof msg === 'string' ? msg : msg ? JSON.stringify(msg) : '';
    } catch {
      // ignore unparsable bodies
    }
    const suffix = detail ? ` — ${detail}` : '';
    const remaining = res.headers.get('x-ratelimit-remaining') ?? res.headers.get('ratelimit-remaining');

    if (res.status === 401) {
      return new ProviderError(`Authentication failed for ${this.host}. Check your token${suffix}`, 'auth', 401);
    }
    if (res.status === 429 || (res.status === 403 && remaining === '0')) {
      return new ProviderError(`Rate limit exceeded on ${this.host}${suffix}`, 'rateLimit', res.status);
    }
    if (res.status === 403) {
      return new ProviderError(`Access denied on ${this.host} (token scope?)${suffix}`, 'forbidden', 403);
    }
    if (res.status === 404) {
      return new ProviderError(`Not found${suffix}`, 'notFound', 404);
    }
    return new ProviderError(`${this.platform} API error ${res.status}${suffix}`, 'http', res.status);
  }
}

export function parseNextLink(header: string | null): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/** Keeps only string labels from untrusted payloads. */
export function stringLabels(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string') : [];
}

function redact(url: string): string {
  return url.replace(/([?&](?:private_token|access_token)=)[^&]+/gi, '$1***');
}
