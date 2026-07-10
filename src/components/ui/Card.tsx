import type { HTMLAttributes, ReactNode } from "react";

type Variant = "default" | "inset" | "metric" | "flat";

const variants: Record<Variant, string> = {
  default:
    "bg-white border border-outline-variant/70 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(120,0,25,0.04)]",
  inset: "bg-surface-container-low border border-outline-variant/60 rounded-2xl",
  metric:
    "bg-white border border-outline-variant/70 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(120,0,25,0.04)] transition-transform duration-200 hover:-translate-y-0.5",
  flat: "bg-white border border-outline-variant/50 rounded-2xl",
};

export default function Card({
  variant = "default",
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <div className={`${variants[variant]} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardBody({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`p-5 sm:p-6 ${className}`}>{children}</div>;
}
