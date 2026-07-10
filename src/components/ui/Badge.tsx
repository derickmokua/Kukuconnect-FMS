import type { ReactNode } from "react";

type Tone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-container-high text-on-surface-variant border-outline-variant/50",
  primary: "bg-primary-fixed text-primary border-primary/15",
  success: "bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-container/30",
  warning: "bg-secondary-fixed text-on-secondary-container border-secondary/25",
  danger: "bg-error-container text-on-error-container border-error/20",
  info: "bg-surface-container-high text-on-surface border-outline-variant",
};

export default function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full border font-label-caps text-[10px] tracking-wider ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function orderStatusTone(
  status: string
): Tone {
  switch (status) {
    case "pending":
      return "warning";
    case "paid":
      return "success";
    case "fulfilled":
      return "info";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}
