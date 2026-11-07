import { keymap } from "@codemirror/view";
/** Per-device preference: quiet drafting hides feedback while lint keeps running underneath. */
export const ZEN_KEY = "composed.zen";
export const readZen = () => localStorage.getItem(ZEN_KEY) === "true";
export function writeZen(on: boolean) {
  localStorage.setItem(ZEN_KEY, String(on));
}
/** `Mod-Shift-.` toggles zen; `Mod-.` stays with dim (editor/dim.ts). */
export const zenKeys = (toggle: () => void) =>
  keymap.of([
    {
      key: "Mod-Shift-.",
      run: () => {
        toggle();
        return true;
      },
    },
  ]);
/** Words in the prose, frontmatter excluded; shown in the status bar in and out of zen. */
export const wordCount = (text: string) =>
  text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu)
    ?.length ?? 0;
