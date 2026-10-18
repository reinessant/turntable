import { useApp } from "./state";
import type { Section } from "./state";

const TABS: { id: Section; label: string }[] = [{ id: "albums", label: "Albums" }, { id: "plugins", label: "Plugins" }, { id: "settings", label: "Settings" }];

/** Top-centre segmented control: Albums | Plugins | Settings. The solid pill slides between them. */
export function TabBar({ disabled }: { disabled: boolean }) {
  const section = useApp((state) => state.section);
  const index = TABS.findIndex((tab) => tab.id === section);
  return <div className="screen tab-layer">
    <nav className="tabs" role="tablist" aria-label="Sections">
      <span className="tabs-pill" style={{ transform: `translateX(${index * 100}%)` }} />
      {TABS.map((tab) => <button key={tab.id} role="tab" aria-selected={tab.id === section} className={tab.id === section ? "on" : ""}
        disabled={disabled} onClick={() => useApp.setState({ section: tab.id })}>{tab.label}</button>)}
    </nav>
  </div>;
}
