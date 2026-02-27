import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

export function Card({ title, description, children, className, ...props }: CardProps) {
  return (
    <div
      className={cn("rounded-xl border bg-card text-card-foreground shadow", className)}
      {...props}
    >
      {(title || description) && (
        <div className="flex flex-col space-y-1.5 p-6">
          {title && (
            <h3 className="font-semibold leading-none tracking-tight">{title}</h3>
          )}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      {children && <div className="p-6 pt-0">{children}</div>}
    </div>
  );
}
