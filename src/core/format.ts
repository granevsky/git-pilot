import type { Platform } from './types';

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
