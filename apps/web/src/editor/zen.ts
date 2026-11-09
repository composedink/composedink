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
