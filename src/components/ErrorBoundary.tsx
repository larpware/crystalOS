import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";
import { Icon } from "@/icons/Icon";
import { useSystemStore } from "@/state/system";

interface Props {
  children: ReactNode;
  /** Shown in the failure message, e.g. "Files". */
  appName: string;
  onClose?: () => void;
}

interface State {
  error: Error | null;
  showDetails: boolean;
  attempt: number;
}

/**
 * Wraps every application window. A crash inside one app renders a compact
 * recovery panel instead of a blank desktop; the shell, other windows and all
 * persisted state are unaffected.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, showDetails: false, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (useSystemStore.getState().developerMode) {
      console.error(`[crescent] ${this.props.appName} crashed`, error, info.componentStack);
    }
  }

  private reload = (): void => {
    this.setState((state) => ({ error: null, showDetails: false, attempt: state.attempt + 1 }));
  };

  render(): ReactNode {
    const { error, showDetails, attempt } = this.state;
    const { children, appName, onClose } = this.props;

    if (!error) {
      return <div key={attempt} style={{ height: "100%", minHeight: 0 }}>{children}</div>;
    }

    const developerMode = useSystemStore.getState().developerMode;

    return (
      <div className="cr-crash">
        <Icon name="warning" size={26} className="cr-empty__icon" />
        <div className="cr-crash__title">Application failed to load.</div>
        <p className="cr-empty__hint">
          {appName} stopped unexpectedly. The rest of CrystalOS is unaffected.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Button variant="primary" icon="refresh" onClick={this.reload}>
            Reload
          </Button>
          {onClose && (
            <Button icon="close" onClick={onClose}>
              Close
            </Button>
          )}
          <Button variant="ghost" onClick={() => this.setState({ showDetails: !showDetails })}>
            {showDetails ? "Hide details" : "View details"}
          </Button>
        </div>
        {showDetails && (
          <pre className="cr-crash__detail">
            {developerMode
              ? `${error.name}: ${error.message}\n\n${error.stack ?? "no stack available"}`
              : `${error.name}: ${error.message}`}
          </pre>
        )}
      </div>
    );
  }
}
