/** The whole DOM toolkit. A framework would be more machinery than this app needs. */

export const el = <T extends HTMLElement>(html: string): T => {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  return host.firstElementChild as T;
};

export const button = (html: string, onClick: () => void): HTMLButtonElement => {
  const node = el<HTMLButtonElement>(html);
  node.addEventListener("click", onClick);
  return node;
};

/** Escape anything that came from a person. Player names are user input. */
export const text = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0).toString()};`);
