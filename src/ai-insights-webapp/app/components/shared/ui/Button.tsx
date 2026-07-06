"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Optional icon rendered alongside (or instead of) the label */
  icon?: ReactNode;
  /** Position of the icon relative to the label */
  iconPosition?: "left" | "right";
  /** Visual style; "primary" uses the brand background, "default" uses the surface */
  variant?: "default" | "primary";
  /** Button label; when omitted the button renders as a square icon-only button */
  children?: ReactNode;
}

export default function Button({
  icon,
  iconPosition = "left",
  variant = "default",
  children,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const isIconOnly = !children;
  const variantClasses =
    variant === "primary"
      ? "bg-primary text-primary-foreground"
      : "bg-surface text-foreground";

  return (
    <button
      type={type}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium shadow-soft transition-[transform,box-shadow] hover:scale-105 hover:shadow-soft-hover ${variantClasses} ${
        isIconOnly ? "w-9" : "px-3"
      } ${className}`}
      {...props}
    >
      {icon && iconPosition === "left" && icon}
      {children}
      {icon && iconPosition === "right" && icon}
    </button>
  );
}
