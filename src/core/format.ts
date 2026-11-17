import type { Platform, RepoSummary } from './types';

/** Platform term for a merge request: GitLab "MR", GitHub "PR". */
export function mrTerm(platform: Platform): 'MR' | 'PR' {
  return platform === 'gitlab' ? 'MR' : 'PR';
}

/** Platform reference syntax: GitLab `!89`, GitHub `#89`. */
export function mrRef(platform: Platform, id: number): string {
  return platform === 'gitlab' ? `!${id}` : `#${id}`;
}

/** Escapes Markdown control characters in server-supplied text. */
export function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

/** Renders a server-supplied label as inline code that cannot escape its backticks. */
export function code(text: string | null): string {
  return text ? `\`${text.replace(/`/g, "'").replace(/[\u0000-\u001f\u007f]+/g, ' ')}\`` : '_no status_';
}

/** Collapses control characters / line breaks so server text stays on one line in tree items. */
export function oneLine(text: string, maxLength = 200): string {
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}

// Bounded quantifiers keep these linear-time on hostile bodies; only a prefix of the body is scanned.
const MEDIA_SCAN_CHARS = 20_000;
const MEDIA_PATTERN =
  /!\[[^\]\n]{0,300}\]\([^)\n]{0,2000}\)|<(?:img|video|picture)\b|\/uploads\/|user-attachments\/|user-images\.githubusercontent\.com/i;
const MEDIA_MARKDOWN = /!\[[^\]\n]{0,300}\]\([^)\n]{0,2000}\)|<(?:img|video|picture)\b[^>\n]{0,2000}>?/gi;

/** Heuristic: does a comment body embed images / videos / uploaded files? (cosmetic hint only) */
export function hasMediaLinks(body: string): boolean {
  return MEDIA_PATTERN.test(body.slice(0, MEDIA_SCAN_CHARS));
}

/** First meaningful line of a comment body for tree rows; embedded media becomes `[media]`. */
export function commentSnippet(body: string, maxLength = 100): string {
  const text = body.slice(0, 2000).replace(MEDIA_MARKDOWN, ' [media] ');
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return oneLine(line, maxLength);
}

/** `just now`, `5 min ago`, `3 h ago`, `2 d ago`, then a local date. Empty for unparsable input. */
export function relativeTime(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) {
    return '';
  }
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(time).toLocaleDateString();
}

/** `base` plus the repository name when it matters (several repositories are open, or one is pinned). */
export function withRepoContext(base: string | undefined, repo: RepoSummary | null): string | undefined {
  const context = repo && (repo.repoCount > 1 || repo.pinned) ? `${oneLine(repo.name, 60)}${repo.pinned ? ' (pinned)' : ''}` : '';
  return [base, context].filter(Boolean).join(' · ') || undefined;
}

/** Appended to "nothing here" messages so the user knows which repository the section is looking at. */
export function repoHint(repo: RepoSummary | null): string {
  return repo && repo.repoCount > 1
    ? ` Repository: ${oneLine(repo.name, 60)}${repo.pinned ? ' (pinned)' : ''} — use "Select Repository…" to switch.`
    : '';
}

/** Masks embedded credentials (`user:token@`) and token query parameters before a URL reaches logs. */
export function redactUrl(url: string): string {
  return url
    .replace(/(\/\/)[^/@\s]+@/g, '$1***@')
    .replace(/([?&](?:private_token|access_token|token)=)[^&\s#]+/gi, '$1***');
}
