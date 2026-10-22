/* Hover tips in Turntable's own look instead of the system's yellow boxes.
   Anything with a `title` (the attribute is taken over: it moves to `data-tip`, so Windows shows nothing), anything with `data-tip`, and
   icon-only buttons (by their `aria-label`) get one. A "(Ctrl+K)" at the end of a tip is drawn as a key cap. */

const SELECTOR = "[data-tip],[title],button[aria-label],[role=button][aria-label],[role=switch][aria-label]";
const SHORTCUT = /^(.*?)\s*\(((?:[^()]*\b(?:Ctrl|Alt|Shift|Cmd)\b[^()]*))\)\s*$/;

/** the tip text of an element, or "" when it has none worth showing */
function textOf(el: Element): string {
  const own = el.getAttribute("title");
  const visible = (el.textContent || "").trim();
  if (own) {
    el.setAttribute("data-tip", own); el.removeAttribute("title");                 // the system tip never gets its chance
    if (!visible && !el.hasAttribute("aria-label")) el.setAttribute("aria-label", own);   // ...but an icon still keeps its name for screen readers
  }
  let text = el.getAttribute("data-tip") || "";
  if (!text && el.hasAttribute("aria-label") && !visible) text = el.getAttribute("aria-label") || "";   // icon-only: the label is the tip
  if (el instanceof HTMLElement && text && text === visible && el.scrollWidth <= el.clientWidth + 1) return "";   // a name that is fully visible already
  return text.trim();
}

export function installTooltips(): () => void {
  const tip = document.createElement("div");
  tip.className = "tt"; tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  let current: Element | null = null, timer = 0, lastHidden = 0, watch = 0;

  const hide = () => {
    clearTimeout(timer); clearInterval(watch); current = null;
    if (tip.classList.contains("on")) { tip.classList.remove("on"); lastHidden = Date.now(); }
  };
  const show = (el: Element, text: string) => {
    const match = SHORTCUT.exec(text);
    tip.textContent = "";
    tip.append(document.createTextNode(match ? match[1] : text));
    if (match) for (const key of match[2].split("+")) { const cap = document.createElement("kbd"); cap.textContent = key.trim(); tip.append(cap); }
    // the artboard is fitted with CSS zoom: the tip follows it, and `left`/`top` are zoomed with it
    // (the mini player and the tray menu are not fitted: their tips keep a fixed size)
    const zoom = document.body.classList.contains("mini-mode") ? 1 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fit")) || 1;
    tip.style.zoom = String(zoom);
    tip.style.left = "0px"; tip.style.top = "0px";
    const at = el.getBoundingClientRect(), size = tip.getBoundingClientRect();
    const gap = 10 * zoom;
    let top = at.bottom + gap;
    if (top + size.height > innerHeight - 6) top = Math.max(6, at.top - size.height - gap);
    const left = Math.min(Math.max(6, at.left + at.width / 2 - size.width / 2), Math.max(6, innerWidth - size.width - 6));
    tip.style.left = (left / zoom).toFixed(1) + "px"; tip.style.top = (top / zoom).toFixed(1) + "px";
    tip.classList.add("on");
    clearInterval(watch);
    watch = window.setInterval(() => { if (!current || !current.isConnected) hide(); }, 250);   // the element went away under the pointer
  };
  const arm = (el: Element, soon: boolean) => {
    const text = textOf(el);
    if (!text) { hide(); return; }
    if (el === current && tip.classList.contains("on")) return;
    hide(); current = el;
    // right after another tip went out, the next one comes at once (moving along a row of buttons)
    timer = window.setTimeout(() => { if (current === el && el.isConnected) show(el, textOf(el) || text); }, soon || Date.now() - lastHidden < 350 ? 40 : 480);
  };

  const over = (event: PointerEvent) => {
    if (event.pointerType === "touch" || !(event.target instanceof Element)) return;
    const el = event.target.closest(SELECTOR);
    if (!el || el.hasAttribute("data-no-tip")) { hide(); return; }
    if (el !== current) arm(el, false);
  };
  const focus = (event: FocusEvent) => {
    if (!(event.target instanceof Element) || !event.target.matches(":focus-visible")) return;
    const el = event.target.closest(SELECTOR);
    if (el && !el.hasAttribute("data-no-tip")) arm(el, true);
  };
  const down = () => hide();
  const out = (event: PointerEvent) => { if (!event.relatedTarget) hide(); };

  document.addEventListener("pointerover", over, true);
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointerout", out, true);
  document.addEventListener("focusin", focus, true);
  document.addEventListener("focusout", down, true);
  document.addEventListener("keydown", down, true);
  document.addEventListener("wheel", down, { capture: true, passive: true });
  addEventListener("scroll", down, true);
  addEventListener("blur", down);
  return () => {
    hide(); tip.remove();
    document.removeEventListener("pointerover", over, true); document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("pointerout", out, true); document.removeEventListener("focusin", focus, true);
    document.removeEventListener("focusout", down, true); document.removeEventListener("keydown", down, true);
    document.removeEventListener("wheel", down, true); removeEventListener("scroll", down, true); removeEventListener("blur", down);
  };
}
