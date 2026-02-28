import React from "react";
import { Button } from "./ui/button";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught:", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center w-full h-full bg-[var(--page-bg)]">
          <div
            className="flex flex-col items-center gap-4 max-w-md text-center"
            style={{ padding: "32px" }}
          >
            <div className="w-12 h-12 rounded-full bg-[var(--accent-red)]/10 flex items-center justify-center">
              <span className="text-2xl">⚠</span>
            </div>
            <h2 className="text-[16px] font-semibold text-[rgba(var(--ui-fg),0.85)]">
              Something went wrong
            </h2>
            <p className="text-[13px] text-[rgba(var(--ui-fg),0.45)] leading-relaxed">
              An unexpected error occurred in the application. You can try
              reloading or dismissing this error.
            </p>
            {this.state.error && (
              <pre
                className="w-full text-left text-[11px] font-mono text-[var(--accent-red)] bg-[rgba(var(--ui-fg),0.03)] border border-[rgba(var(--ui-fg),0.06)] rounded-lg overflow-auto max-h-32"
                style={{ padding: "12px" }}
              >
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-2">
              <Button onClick={this.handleReload}>Reload</Button>
              <Button variant="ghost" onClick={this.handleDismiss}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
