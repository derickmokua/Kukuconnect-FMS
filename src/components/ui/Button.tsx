import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "gold";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary/90 shadow-sm shadow-primary/15",
  secondary:
    "bg-white text-on-surface border border-outline-variant hover:bg-surface-container-high",
  ghost:
    "bg-transparent text-on-surface-variant hover:bg-surface-variant hover:text-on-surface",
  danger:
    "bg-error-container text-on-error-container border border-error/20 hover:bg-error/10",
  success:
    "bg-tertiary-container text-white hover:opacity-90 shadow-sm",
  gold:
    "bg-secondary-container text-on-secondary-container hover:opacity-90 font-semibold",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs rounded-lg gap-1.5",
  md: "px-4 py-2.5 text-sm rounded-xl gap-2",
  lg: "px-6 py-3.5 text-base rounded-xl gap-2 font-semibold",
};

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${className}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
