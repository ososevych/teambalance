import type { Avatars } from "../storage/github.js";
import type { Player } from "../core/types.js";
import { text } from "./dom.js";

/** A stable hue per player, so the fallback circle is recognisable in a list. */
const hueOf = (id: string): number => {
  let hue = 0;
  for (const char of id) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return hue;
};

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join("")
    .toUpperCase() || "?";

/**
 * A photo when there is one, initials otherwise.
 *
 * Photos come from `avatars.json` in the private data repo (#9), so they are
 * visible only to someone holding the token. Initials are not a placeholder
 * waiting to be replaced — they stay the fallback for anyone without a crop.
 */
export const avatarHtml = (player: Player, avatars: Avatars, size: "sm" | "lg" = "lg"): string => {
  const photo = avatars[player.id];
  const cls = `av ${size}`;
  if (photo !== undefined && photo.startsWith("data:image/")) {
    return `<img class="${cls}" src="${text(photo)}" alt="" />`;
  }
  return `<span class="${cls}" style="background:hsl(${String(hueOf(player.id))} 42% 38%)" aria-hidden="true">${text(initialsOf(player.name))}</span>`;
};
