import { useEffect, useRef, useState } from "react";
import { useApp } from "./state";
import { scConfigured, scConnect, scDisconnect } from "./soundcloud";

/** SoundCloud mark (bars + cloud), drawn in currentColor so it sits with the other icons. */
export function ScLogo({ size = 16 }: { size?: number }) {
  return <svg width={size * 2} height={size} viewBox="0 0 32 16" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
    {[[0, 10], [2.2, 8], [4.4, 6], [6.6, 7], [8.8, 4], [11, 3]].map(([x, top]) => <rect key={x} x={x} y={top} width="1.3" height={16 - top} rx=".65" />)}
    <path d="M13.4 16V3.6C14.6 2.6 16.2 2 17.9 2c3.4 0 6.2 2.5 6.6 5.7.6-.3 1.3-.4 2-.4 2.6 0 4.6 2.1 4.6 4.4S29.1 16 26.5 16Z" />
  </svg>;
}
export function ArrowOut({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true" style={{ display: "block" }}>
    <path d="M4 2.5h5.5V8M9.3 2.7 2.5 9.5" />
  </svg>;
}

/** Crate header control: connect, show the account, sync or sign out. */
export function SoundCloudButton() {
  const user = useApp((state) => state.scUser);
  const busy = useApp((state) => state.scBusy);
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(false); };
    addEventListener("pointerdown", close); return () => removeEventListener("pointerdown", close);
  }, [menu]);
  const connect = async () => {
    if (!scConfigured()) { useApp.setState({ message: "SoundCloud isn't set up in this build yet (app keys missing)" }); return; }
    useApp.setState({ scBusy: true });
    try { useApp.setState({ scUser: await scConnect(), scBusy: false, scSheet: true }); }
    catch (error) { useApp.setState({ message: String(error instanceof Error ? error.message : error), scBusy: false }); }
  };
  if (!user) return <button className="pill-btn sc-btn" disabled={busy} onClick={() => void connect()}>
    <ScLogo size={9} />{busy ? "Waiting for SoundCloud…" : "Connect SoundCloud"}</button>;
  return <div className="sc-account" ref={root}>
    <button className={"pill-btn sc-btn" + (menu ? " open" : "")} onClick={() => setMenu(!menu)} aria-expanded={menu}>
      {user.avatar ? <img className="sc-avatar" src={user.avatar} alt="" /> : <ScLogo size={9} />}
      <span>{user.username}</span>
    </button>
    {menu && <div className="sc-menu" role="menu">
      <div className="sc-menu-head"><ScLogo size={8} /><span>Connected as <b>{user.username}</b></span></div>
      <button role="menuitem" onClick={() => { setMenu(false); useApp.setState({ scSheet: true }); }}>Add from SoundCloud…</button>
      <button role="menuitem" onClick={async () => {
        setMenu(false);
        await scDisconnect();
        // records stay in the crate; they play again after the next sign-in
        useApp.setState({ scUser: null, message: "SoundCloud disconnected" });
      }}>Disconnect</button>
    </div>}
  </div>;
}
