import {
  BookOpen,
  Languages,
  Sparkles,
  Puzzle,
  Volume2,
  ExternalLink,
  Plus,
  Check,
  X,
  Bookmark,
  GraduationCap,
  RefreshCw,
  Lightbulb,
  type IconNode,
} from 'lucide';

export interface IconOptions {
  size?: number;
  color?: string;
  strokeWidth?: number;
  class?: string;
}

export function iconToSvg(iconNode: IconNode, options: IconOptions = {}): string {
  const size = options.size ?? 18;
  const color = options.color ?? 'currentColor';
  const strokeWidth = options.strokeWidth ?? 2;
  const cls = options.class ? ` ${options.class}` : '';

  const inner = iconNode
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${attrStr}></${tag}>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="eir-icon${cls}">${inner}</svg>`;
}

export const Icons = {
  book: (opts?: IconOptions) => iconToSvg(BookOpen, opts),
  languages: (opts?: IconOptions) => iconToSvg(Languages, opts),
  sparkles: (opts?: IconOptions) => iconToSvg(Sparkles, opts),
  puzzle: (opts?: IconOptions) => iconToSvg(Puzzle, opts),
  volume: (opts?: IconOptions) => iconToSvg(Volume2, opts),
  externalLink: (opts?: IconOptions) => iconToSvg(ExternalLink, opts),
  plus: (opts?: IconOptions) => iconToSvg(Plus, opts),
  check: (opts?: IconOptions) => iconToSvg(Check, opts),
  close: (opts?: IconOptions) => iconToSvg(X, opts),
  bookmark: (opts?: IconOptions) => iconToSvg(Bookmark, opts),
  graduationCap: (opts?: IconOptions) => iconToSvg(GraduationCap, opts),
  refresh: (opts?: IconOptions) => iconToSvg(RefreshCw, opts),
  lightbulb: (opts?: IconOptions) => iconToSvg(Lightbulb, opts),
};
