/* Turntable Setup: the record (grab it — the music scratches with it), the arm that rides across it while the
   real setup runs, and the few words around it. Talks to Rust through window.__TAURI__ (status, install, launch). */
const T = window.__TAURI__;
const invoke = (cmd, args) => T ? T.core.invoke(cmd, args) : Promise.reject(new Error("no tauri"));
const win = T ? T.window.getCurrentWindow() : null;
const $ = (s) => document.querySelector(s);

/* ---------------------------------------------------------------- words */
const STR = { ru: {
  kicker: "Установка", kickerUpdate: "Обновление", tagline: "Твои альбомы — на проигрывателе.", install: "Установить", update: "Обновить", reinstall: "Переустановить",
  desktop: "Ярлык на рабочем столе", launchAfter: "Запустить после установки", path: "Папка", hint: "Хватай пластинку — она скретчится",
  steps: ["Распаковка…", "Копируем файлы…", "Проверяем WebView2…", "Создаём ярлыки…", "Почти готово…"],
  done: "Готово", doneSub: "Turntable установлен. Пластинка ждёт.", doneUpdated: "Turntable обновлён. Пластинка ждёт.", launch: "Запустить Turntable", close: "Закрыть",
  running: "Turntable открыт", runningSub: "Закрой его, чтобы установка смогла его обновить.", closeApp: "Закрыть Turntable", back: "Назад",
  failed: "Не получилось", retry: "Ещё раз", classic: "Обычный установщик"
}, en: {
  kicker: "Setup", kickerUpdate: "Update", tagline: "Your albums, on a record player.", install: "Install", update: "Update", reinstall: "Reinstall",
  desktop: "Desktop shortcut", launchAfter: "Open when done", path: "Folder", hint: "Grab the record — it scratches",
  steps: ["Unpacking…", "Copying files…", "Checking WebView2…", "Creating shortcuts…", "Almost there…"],
  done: "Done", doneSub: "Turntable is installed. The record is waiting.", doneUpdated: "Turntable is updated. The record is waiting.", launch: "Launch Turntable", close: "Close",
  running: "Turntable is open", runningSub: "Close it so the setup can update it.", closeApp: "Close Turntable", back: "Back",
  failed: "Setup failed", retry: "Try again", classic: "Classic setup"
} };
/* the language: the one picked in the switch last time, else the system's (Russian, Ukrainian, Belarusian, Kazakh → Russian) */
const saved = (() => { try { return localStorage.getItem("setup-lang"); } catch { return null; } })();
let lang = saved === "ru" || saved === "en" ? saved : /^(ru|uk|be|kk)/i.test(navigator.language || "") ? "ru" : "en";
let S = STR[lang];
/* what the button says: nothing installed → Install; an older Turntable (or one whose version is unknown) → Update;
   the same version → Reinstall */
let mode = "install", version = "";
const older = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
const text = { tagline: "tagline", optDesktopText: "desktop", optLaunchText: "launchAfter", pathLabel: "path", hint: "hint",
  doneTitle: "done", doneSub: "doneSub", launchBtn: "launch", doneClose: "close", runTitle: "running", runSub: "runningSub", closeAppBtn: "closeApp", runBack: "back",
  errTitle: "failed", retryBtn: "retry", classicBtn: "classic" };
function applyLang() {
  S = STR[lang];
  for (const [id, key] of Object.entries(text)) $("#" + id).textContent = S[key];
  $("#kicker").textContent = (mode === "update" ? S.kickerUpdate : S.kicker) + (version ? " · v" + version : "");
  $("#installBtn").textContent = S[mode];
  $("#doneSub").textContent = mode === "update" ? S.doneUpdated : S.doneSub;
  document.documentElement.lang = lang;
  document.querySelectorAll("#langSwitch button").forEach((b) => { const on = b.dataset.l === lang; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
}
applyLang();
document.querySelectorAll("#langSwitch button").forEach((b) => b.addEventListener("click", () => {
  lang = b.dataset.l; try { localStorage.setItem("setup-lang", lang); } catch {}
  applyLang();
}));

/* ---------------------------------------------------------------- state */
const card = $("#card");
let view = "idle";
const show = (v) => { card.classList.remove(view + "-on"); view = v; card.classList.add(v + "-on"); };
show("idle");

/* ---------------------------------------------------------------- the record */
const C = { x: 235, y: 280 }, R = 190;
const MOTOR = 2 * Math.PI * (100 / 3) / 60;                 // 33⅓ rpm in rad/s
const record = $("#record");
let angle = 0, omega = 0, motor = true, grabbed = null, everGrabbed = false;
const cardBox = () => card.getBoundingClientRect();
const pointerAngle = (e) => { const b = cardBox(); return Math.atan2(e.clientY - b.top - C.y, e.clientX - b.left - C.x); };
record.addEventListener("pointerdown", (e) => {
  Music.wake();
  record.setPointerCapture(e.pointerId); record.classList.add("grabbed");
  grabbed = { last: pointerAngle(e), time: performance.now(), v: 0 };
  if (!everGrabbed) { everGrabbed = true; $("#hint").style.opacity = 0; }
});
record.addEventListener("pointermove", (e) => {
  if (!grabbed) return;
  const a = pointerAngle(e), now = performance.now();
  let d = a - grabbed.last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
  angle += d;
  const dt = Math.max(.004, (now - grabbed.time) / 1000);
  grabbed.v = grabbed.v * .5 + (d / dt) * .5; grabbed.last = a; grabbed.time = now;
});
const release = () => { if (!grabbed) return; omega = grabbed.v; grabbed = null; record.classList.remove("grabbed"); };
record.addEventListener("pointerup", release); record.addEventListener("pointercancel", release);

/* ---------------------------------------------------------------- the arm: angle that puts the stylus at radius r */
const PIVOT = { x: 442, y: 62 }, ARM = 278, REST = -6;
(() => { // wrap the arm in a group at the pivot
  const svg = $("#arm"), g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("transform", `translate(${PIVOT.x} ${PIVOT.y})`);
  [...svg.childNodes].forEach((n) => g.appendChild(n)); svg.appendChild(g);
})();
const stylusAt = (deg) => { const r = deg * Math.PI / 180; return { x: PIVOT.x - ARM * Math.sin(r), y: PIVOT.y + ARM * Math.cos(r) }; };
const angleFor = (radius) => { let best = REST, err = 1e9; for (let d = -10; d <= 70; d += .05) { const s = stylusAt(d), e = Math.abs(Math.hypot(s.x - C.x, s.y - C.y) - radius); if (e < err) { err = e; best = d; } } return best; };
const OUTER = angleFor(R * .93), INNER = angleFor(R * .42);
let armDeg = REST, armTarget = REST;

/* ---------------------------------------------------------------- progress */
let progress = 0, shown = 0, busySince = 0, finishing = null;
const ringFill = $("#ringFill"), RING = 2 * Math.PI * 48.5;
function stepText(p) { const s = S.steps; return p < .15 ? s[0] : p < .45 ? s[1] : p < .7 ? s[2] : p < .88 ? s[3] : s[4]; }

/* ---------------------------------------------------------------- frame loop */
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  // record: held → follows the hand; free → the motor pulls it back to 33⅓ (or lets it coast to a stop)
  if (grabbed) { omega = grabbed.v; if (now - grabbed.time > 60) grabbed.v *= Math.pow(.001, dt * 6); }
  else { omega += ((motor ? MOTOR : 0) - omega) * (1 - Math.exp(-dt / .38)); angle += omega * dt; }
  record.style.transform = `rotate(${angle}rad)`;
  Music.setRate(omega / MOTOR);
  // progress: eases toward 90% while setup runs; the finish sweeps it to 100%
  if (view === "busy") {
    const t = (now - busySince) / 1000;
    progress = finishing ? Math.min(1, finishing.from + (1 - finishing.from) * Math.min(1, (now - finishing.at) / 700)) : .9 * (1 - Math.exp(-t / 2.4));
    shown += (progress - shown) * (1 - Math.exp(-dt / .12));
    $("#pct").textContent = Math.round(shown * 100); $("#bar").style.width = (shown * 100).toFixed(1) + "%"; $("#step").textContent = stepText(shown);
    armTarget = OUTER + (INNER - OUTER) * shown;
  }
  // the screen switches to "done" a beat before the eased value has caught up with 100%: finish the lap here,
  // or the ring stops a few pixels short of closing
  if (view === "done") { shown += (1 - shown) * (1 - Math.exp(-dt / .09)); if (shown > .9995) shown = 1; }
  ringFill.style.strokeDasharray = `${(shown * RING).toFixed(2)} 400`;
  // arm: a damped swing to its target
  armDeg += (armTarget - armDeg) * (1 - Math.exp(-dt / .16));
  $("#armRot").setAttribute("transform", `rotate(${armDeg.toFixed(3)})`);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------------------------------------------------------------- flow */
let installed = null;
async function begin() {
  if (view === "busy") return;
  Music.wake();
  show("busy"); busySince = performance.now(); progress = shown = 0; finishing = null;
  armTarget = OUTER;
  const started = performance.now();
  try {
    installed = await invoke("install", { desktop: $("#optDesktop").checked });
    await new Promise((r) => setTimeout(r, Math.max(0, 3200 - (performance.now() - started))));
    finishing = { from: progress, at: performance.now() };
    await new Promise((r) => setTimeout(r, 800));
    armTarget = REST;
    ripple();
    show("done");
    if ($("#optLaunch").checked) setTimeout(() => { if (view === "done") go(); }, 2600);
  } catch (error) {
    armTarget = REST; shown = progress = 0;
    if (String(error).includes("running")) show("running");
    else { $("#errText").textContent = String(error); show("failed"); }
  }
}
function ripple() {
  const w = $("#wave");
  w.animate([{ width: `${2 * R}px`, height: `${2 * R}px`, marginLeft: `${-R}px`, marginTop: `${-R}px`, opacity: .9 },
    { width: "1500px", height: "1500px", marginLeft: "-750px", marginTop: "-750px", opacity: 0 }], { duration: 1600, easing: "cubic-bezier(.16,1,.3,1)" });
  $("#glow").animate([{ opacity: .7 }, { opacity: 1.6 }, { opacity: .7 }], { duration: 1600, easing: "ease-out" });
}
async function go() { try { await invoke("launch", { path: installed }); } catch (e) { $("#errText").textContent = String(e); show("failed"); } }

$("#installBtn").addEventListener("click", begin);
$("#launchBtn").addEventListener("click", go);
$("#doneClose").addEventListener("click", () => invoke("quit"));
$("#retryBtn").addEventListener("click", begin);
$("#classicBtn").addEventListener("click", () => invoke("classic"));
$("#closeAppBtn").addEventListener("click", async () => { await invoke("close_app").catch(() => {}); begin(); });
$("#runBack").addEventListener("click", () => show("idle"));
$("#min").addEventListener("click", () => win?.minimize());
$("#close").addEventListener("click", () => invoke("quit").catch(() => window.close()));
$("#mute").addEventListener("click", () => { Music.setMuted(!Music.muted); $("#muteOn").style.display = Music.muted ? "none" : "block"; $("#muteOff").style.display = Music.muted ? "block" : "none"; });
$("#muteOff").style.display = "none";
addEventListener("keydown", (e) => { if (e.key === "Enter" && view === "idle") begin(); if (e.key === "m" || e.key === "M") $("#mute").click(); });
addEventListener("contextmenu", (e) => e.preventDefault());

/* ---------------------------------------------------------------- open */
(async () => {
  try { const st = await invoke("status"); $("#pathText").textContent = st.dir; version = st.version || ""; if (st.installed) mode = st.installed_version && !older(st.installed_version, version) ? "reinstall" : "update"; applyLang(); }
  catch { $("#pathText").textContent = "%LOCALAPPDATA%\\Turntable"; }
  await document.fonts.ready;
  requestAnimationFrame(() => requestAnimationFrame(async () => {
    card.classList.add("in");
    try { await win?.show(); await win?.setFocus(); } catch {}
  }));
})();
