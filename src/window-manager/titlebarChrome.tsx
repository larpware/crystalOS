import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* ==========================================================================
   Titlebar chrome

   A window draws a short bar above its content: three controls and, in the
   middle, the application's icon and title. Some applications have something
   better to put there than a title — the browser's tab strip is the obvious
   one, and a row of tabs above a row that already says the application's name
   is two rows doing one row's job.

   So the window renders an empty element in the middle of its own bar and
   passes it down through this context. An application portals into it, and
   asks the window's own title to stand down.

   Everything interactive rendered this way must carry `data-no-drag`: the bar
   is the window's drag handle, and that attribute is what tells the drag — and
   the double-click-to-maximise — to keep off.
   ========================================================================== */

export interface WindowChromeApi {
  /** The element in the titlebar to render into, once the window has mounted. */
  slot: HTMLElement | null;
  /**
   * Hides the window's own icon and title so application chrome leads. Set it
   * `true` while mounted and back to `false` on unmount — a window can be
   * re-used by a different application.
   */
  setReplacesTitle: (replaces: boolean) => void;
}

export const WindowChromeContext = createContext<WindowChromeApi>({
  slot: null,
  setReplacesTitle: () => {},
});

/** Renders its children into the titlebar of the window it is used in. */
export function WindowTitlebarChrome({ children }: { children: ReactNode }) {
  const { slot } = useContext(WindowChromeContext);
  // The slot is empty until the window has mounted; the first render of any
  // application therefore has nowhere to portal into, which is expected.
  return slot ? createPortal(children, slot) : null;
}
