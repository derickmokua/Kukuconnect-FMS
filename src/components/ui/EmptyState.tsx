import type { ReactNode } from "react";
import Card, { CardBody } from "./Card";

export default function EmptyState({
  icon = "inbox",
  title,
  children,
  action,
}: {
  icon?: string;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardBody className="text-center py-12 px-6">
        <span className="material-symbols-outlined text-4xl text-outline mb-3">
          {icon}
        </span>
        {title && (
          <p className="font-semibold text-on-surface mb-1">{title}</p>
        )}
        <div className="text-sm text-on-surface-variant max-w-md mx-auto">
          {children}
        </div>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </CardBody>
    </Card>
  );
}
