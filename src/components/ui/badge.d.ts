import type * as React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline";
}

export function Badge(props: BadgeProps): React.ReactElement;
export function badgeVariants(props?: Pick<BadgeProps, "className" | "variant">): string;
