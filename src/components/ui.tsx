import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/icons/Icon";

/* ==========================================================================
   Primitives

   Small, unopinionated building blocks. Every one of them is themed purely by
   tokens, so a theme swap restyles the entire OS without touching app code.
   ========================================================================== */

type ButtonVariant = "default" | "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", icon, iconRight, block, className, children, ...rest },
  ref,
) {
  const classes = [
    "cr-btn",
    variant !== "default" && `cr-btn--${variant}`,
    size !== "md" && `cr-btn--${size}`,
    block && "cr-btn--block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const iconSize = size === "lg" ? 17 : size === "sm" ? 14 : 15;
  return (
    <button ref={ref} type="button" className={classes} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 16, active, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={["cr-icon-btn", className].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
});

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, label, disabled, id }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      className="cr-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}

export function Field({ label, hint, error, children, htmlFor }: FieldProps) {
  return (
    <div className="cr-field">
      {label && (
        <label className="cr-field__label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <span className="cr-field__error">{error}</span>
      ) : hint ? (
        <span className="cr-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: IconName;
  invalid?: boolean;
  trailing?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { icon, invalid, trailing, className, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      className={["cr-input", invalid && "cr-input--invalid", className].filter(Boolean).join(" ")}
      {...rest}
    />
  );

  if (!icon && !trailing) return input;

  return (
    <div className="cr-input-group">
      {icon && <Icon name={icon} size={15} className="cr-input-group__icon" />}
      {input}
      {trailing && <span className="cr-input-group__action">{trailing}</span>}
    </div>
  );
});

export const PasswordInput = forwardRef<HTMLInputElement, Omit<TextInputProps, "type">>(
  function PasswordInput(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <TextInput
        ref={ref}
        {...props}
        type={visible ? "text" : "password"}
        trailing={
          <IconButton
            icon={visible ? "eye-off" : "eye"}
            label={visible ? "Hide password" : "Show password"}
            size={15}
            onClick={() => setVisible((value) => !value)}
            tabIndex={-1}
          />
        }
      />
    );
  },
);

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, className, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={["cr-select", className].filter(Boolean).join(" ")} {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
});

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  label: string;
  format?: (value: number) => string;
  disabled?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  label,
  format,
  disabled,
}: SliderProps) {
  return (
    <div className="cr-slider">
      <div className="cr-slider__track">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerUp={() => onCommit?.(value)}
          onKeyUp={() => onCommit?.(value)}
        />
      </div>
      <span className="cr-slider__value cr-num">{format ? format(value) : value}</span>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
  label: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: SegmentedProps<T>) {
  return (
    <div className="cr-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="cr-segmented__item"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <Icon name={option.icon} size={13} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface BadgeProps {
  children: ReactNode;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  icon?: IconName;
}

export function Badge({ children, tone = "default", icon }: BadgeProps) {
  return (
    <span className={["cr-badge", tone !== "default" && `cr-badge--${tone}`].filter(Boolean).join(" ")}>
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

interface ChipProps {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  icon?: IconName;
}

export function Chip({ children, active, onClick, icon }: ChipProps) {
  return (
    <button type="button" className="cr-chip" aria-pressed={active} onClick={onClick}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </button>
  );
}

interface RowProps {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
}

/** A settings row: label, optional description, and one control. */
export function Row({ label, description, control, children, stacked }: RowProps) {
  if (stacked) {
    return (
      <div className="cr-row cr-row--stack">
        <div className="cr-row__text">
          <div className="cr-row__label">{label}</div>
          {description && <div className="cr-row__desc">{description}</div>}
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="cr-row">
      <div className="cr-row__text">
        <div className="cr-row__label">{label}</div>
        {description && <div className="cr-row__desc">{description}</div>}
      </div>
      <div className="cr-row__control">{control ?? children}</div>
    </div>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="cr-section">
      {title && <h3 className="cr-section__title">{title}</h3>}
      {description && <p className="cr-section__desc">{description}</p>}
      {children}
    </section>
  );
}

export function EmptyState({
  icon = "info",
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="cr-empty">
      <Icon name={icon} size={26} className="cr-empty__icon" />
      <div className="cr-empty__title">{title}</div>
      {hint && <p className="cr-empty__hint">{hint}</p>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="cr-spinner" role="status" aria-label={label} />;
}

export function Progress({ value, max = 100 }: { value: number; max?: number }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="cr-progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="cr-progress__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Skeleton({ width = "100%", height = 12, radius = 5 }: { width?: number | string; height?: number; radius?: number }) {
  return <div className="cr-skeleton" style={{ width, height, borderRadius: radius }} />;
}

/* ---- popover ----------------------------------------------------------- */

interface PopoverProps {
  trigger: (props: { ref: React.Ref<HTMLButtonElement>; onClick: () => void; "aria-expanded": boolean }) => ReactNode;
  children: ReactNode;
  align?: "start" | "end" | "center";
  width?: number;
  side?: "top" | "bottom";
  offset?: number;
}

export function Popover({
  trigger,
  children,
  align = "end",
  width = 260,
  side = "bottom",
  offset = 8,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const shotWidth = panelRef.current?.offsetWidth ?? width;
      const shotHeight = panelRef.current?.offsetHeight ?? 200;
      let left = anchor.right - shotWidth;
      if (align === "start") left = anchor.left;
      if (align === "center") left = anchor.left + anchor.width / 2 - shotWidth / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - shotWidth - 8));

      let top = side === "bottom" ? anchor.bottom + offset : anchor.top - shotHeight - offset;
      if (top + shotHeight > window.innerHeight - 8) top = Math.max(8, anchor.top - shotHeight - offset);
      if (top < 8) top = 8;
      setPosition({ top, left });
    };

    update();
    const observer = new ResizeObserver(update);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, align, side, offset, width]);

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen((value) => !value),
        "aria-expanded": open,
      })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="cr-popover"
            role="dialog"
            style={{ position: "fixed", top: position.top, left: position.left, width, zIndex: "var(--z-overlay)" }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ---- modal ------------------------------------------------------------- */

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Modal({ open, title, onClose, children, footer, width = 480 }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    // Focus the first interactive control so the dialog is keyboard-operable.
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("input, button, select, textarea")?.focus();
    }, 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="cr-scrim" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className="cr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: width }}
      >
        <header className="cr-modal__header">
          <h2 className="cr-modal__title" id={titleId}>
            {title}
          </h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        <div className="cr-modal__body">{children}</div>
        {footer && <footer className="cr-modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ---- menu -------------------------------------------------------------- */

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  run?: () => void;
}

export function Menu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(6, Math.min(x, window.innerWidth - rect.width - 6)),
      top: Math.max(6, Math.min(y, window.innerHeight - rect.height - 6)),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="cr-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="cr-menu__sep" />}
          <button
            type="button"
            role="menuitem"
            className={["cr-menu__item", item.danger && "cr-menu__item--danger"]
              .filter(Boolean)
              .join(" ")}
            disabled={item.disabled}
            onClick={() => {
              item.run?.();
              onClose();
            }}
          >
            {item.icon ? <Icon name={item.icon} size={15} /> : <span style={{ width: 15 }} />}
            <span className="cr-menu__label">{item.label}</span>
            {item.hint && <span className="cr-menu__hint">{item.hint}</span>}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ---- tooltip ----------------------------------------------------------- */

/**
 * Lightweight tooltip. Shows the label above the wrapped element after a
 * short delay and positions itself inside the viewport.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = () => {
    const element = hostRef.current;
    if (!element) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = element.getBoundingClientRect();
      setCoords({
        x: Math.min(Math.max(rect.left + rect.width / 2, 60), window.innerWidth - 60),
        y: Math.max(rect.top - 8, 14),
      });
    }, 400);
  };

  const hide = () => {
    window.clearTimeout(timer.current);
    setCoords(null);
  };

  return (
    <span
      ref={hostRef}
      style={{ display: "inline-flex" }}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {coords &&
        createPortal(
          <div
            className="cr-tooltip"
            role="tooltip"
            style={{ left: coords.x, top: coords.y, transform: "translate(-50%, -100%)" }}
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
