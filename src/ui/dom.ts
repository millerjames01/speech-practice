/** Tiny DOM helpers, so views read as structure rather than boilerplate. */

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; dataset?: Record<string, string> } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, dataset, ...rest } = props;
  if (className) node.className = className;
  if (dataset) Object.assign(node.dataset, dataset);
  Object.assign(node, rest);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const b = el('button', { class: className, type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

/** Surfaces an error where the user can see it instead of only in the console. */
export function errorBox(message: string): HTMLElement {
  return el('div', { class: 'error' }, message);
}
