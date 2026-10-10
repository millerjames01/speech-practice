/**
 * Answer patterns: `(x)` marks an optional part, `[a|b]` picks one of several
 * alternatives. Both nest. "(Jo) [vaig menjar|he menjat] pa" expands to four
 * accepted answers, and its canonical form is "Vaig menjar pa". Optional
 * punctuation such as "(,)" is kept in the canonical form.
 */

/** Hard cap on expansions, so a careless pattern fails loudly instead of hanging. */
export const MAX_EXPANSIONS = 256;

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'optional'; body: Node[] }
  | { kind: 'choice'; options: Node[][] };

function parse(pattern: string): Node[] {
  let pos = 0;

  const parseSeq = (closers: string): Node[] => {
    const nodes: Node[] = [];
    let text = '';
    const flush = () => {
      if (text) nodes.push({ kind: 'text', value: text });
      text = '';
    };
    while (pos < pattern.length) {
      const ch = pattern[pos]!;
      if (closers.includes(ch)) break;
      if (ch === ')' || ch === ']' || ch === '|') {
        throw new Error(`Unexpected "${ch}" at ${pos} in pattern: ${pattern}`);
      }
      if (ch === '(') {
        flush();
        pos += 1;
        const body = parseSeq(')');
        if (pattern[pos] !== ')') throw new Error(`Unclosed "(" in pattern: ${pattern}`);
        pos += 1;
        nodes.push({ kind: 'optional', body });
      } else if (ch === '[') {
        flush();
        pos += 1;
        const options: Node[][] = [parseSeq('|]')];
        while (pattern[pos] === '|') {
          pos += 1;
          options.push(parseSeq('|]'));
        }
        if (pattern[pos] !== ']') throw new Error(`Unclosed "[" in pattern: ${pattern}`);
        pos += 1;
        nodes.push({ kind: 'choice', options });
      } else {
        text += ch;
        pos += 1;
      }
    }
    flush();
    return nodes;
  };

  const nodes = parseSeq('');
  if (pos !== pattern.length) throw new Error(`Unbalanced pattern: ${pattern}`);
  return nodes;
}

function expandSeq(nodes: Node[]): string[] {
  let acc: string[] = [''];
  for (const node of nodes) {
    let next: string[];
    if (node.kind === 'text') {
      next = acc.map((a) => a + node.value);
    } else if (node.kind === 'optional') {
      const inner = expandSeq(node.body);
      next = [];
      for (const a of acc) {
        next.push(a);
        for (const i of inner) next.push(a + i);
      }
    } else {
      const inner = node.options.flatMap(expandSeq);
      next = [];
      for (const a of acc) for (const i of inner) next.push(a + i);
    }
    if (next.length > MAX_EXPANSIONS) {
      throw new Error(`Pattern expands to more than ${MAX_EXPANSIONS} answers`);
    }
    acc = next;
  }
  return acc;
}

/** An optional that is only punctuation, like "(,)": shown, since it never changes the words. */
const isPunctuationOnly = (nodes: Node[]): boolean =>
  nodes.every((n) => n.kind === 'text' && /^[\s,;:]+$/.test(n.value));

function canonicalSeq(nodes: Node[]): string {
  return nodes
    .map((node) =>
      node.kind === 'text'
        ? node.value
        : node.kind === 'optional'
          ? isPunctuationOnly(node.body)
            ? canonicalSeq(node.body)
            : ''
          : canonicalSeq(node.options[0] ?? []),
    )
    .join('');
}

/** Collapses the gaps left by dropped optionals: double spaces, space before punctuation. */
export function tidy(text: string): string {
  const out = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:…»)])/g, '$1')
    .replace(/([«¿¡(])\s+/g, '$1')
    .trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Every accepted answer, canonical first, de-duplicated. */
export function expand(pattern: string): string[] {
  const all = [canonical(pattern), ...expandSeq(parse(pattern)).map(tidy)];
  return [...new Set(all)].filter((s) => s.length > 0);
}

/** The preferred answer: optional words dropped, first alternative everywhere. */
export function canonical(pattern: string): string {
  return tidy(canonicalSeq(parse(pattern)));
}
