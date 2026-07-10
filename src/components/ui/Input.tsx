import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Field({
  label,
  children,
  className = "",
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      {label && (
        <span className="text-sm text-on-surface-variant font-medium">
          {label}
        </span>
      )}
      {children}
    </label>
  );
}

const controlClass =
  "w-full bg-white border border-outline-variant rounded-xl px-4 py-3 text-on-surface text-sm placeholder:text-on-surface-variant/50 transition-shadow";

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${controlClass} ${className}`} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${controlClass} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function TextArea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`${controlClass} min-h-[88px] resize-y ${className}`}
      {...props}
    />
  );
}
