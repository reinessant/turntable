import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
interface Props { children: ReactNode; name?: string }
interface State { error: Error | null }
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Screen error", this.props.name || "app", error, info.componentStack);
  }
  render(): ReactNode {
    if (this.state.error) return <div className="error-screen" role="alert">
      <strong>{this.props.name || "App"} failed to render</strong>
      <pre>{this.state.error.message}</pre>
      <button onClick={() => { this.setState({ error: null }); location.reload(); }}>Reload</button>
    </div>;
    return this.props.children;
  }
}
