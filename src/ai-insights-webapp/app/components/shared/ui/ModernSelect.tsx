"use client";

import React, { useState, useRef, useEffect, ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface ModernSelectOption {
  value: string | number;
  label: string;
  icon?: ReactNode;
  badge?: string;
  badgeColor?: string;
  description?: string;
  disabled?: boolean;
}

interface ModernSelectProps {
  value: string | number;
  onChange: (value: string) => void;
  options: readonly ModernSelectOption[] | ModernSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  dropdownPosition?: "top" | "bottom" | "auto";
  icon?: ReactNode;
}

export default function ModernSelect({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  disabled = false,
  className = "",
  triggerClassName = "",
  menuClassName = "",
  dropdownPosition = "auto",
  icon,
}: ModernSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (optValue: string | number) => {
    onChange(String(optValue));
    setIsOpen(false);
  };

  const isPositionTop = dropdownPosition === "top";

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full h-9.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 transition-all select-none ${
          disabled
            ? "border-border/40 bg-surface-muted/30 text-muted-foreground/50 cursor-not-allowed"
            : isOpen
            ? "border-primary ring-2 ring-primary/15 bg-surface text-foreground shadow-xs cursor-pointer"
            : "border-border/80 bg-surface-muted/60 hover:bg-surface hover:border-primary/40 text-foreground cursor-pointer shadow-2xs"
        } ${triggerClassName}`}
      >
        <div className="flex items-center gap-2 truncate min-w-0">
          {selectedOption?.icon ? (
            <span className="shrink-0 text-primary">{selectedOption.icon}</span>
          ) : icon ? (
            <span className="shrink-0 text-muted-foreground">{icon}</span>
          ) : null}
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.badge && (
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                selectedOption.badgeColor || "bg-primary/10 text-primary"
              }`}
            >
              {selectedOption.badge}
            </span>
          )}
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${
            isOpen ? "rotate-180 text-primary" : ""
          }`}
        />
      </button>

      {isOpen && !disabled && (
        <div
          className={`absolute left-0 w-full min-w-[200px] z-[200] rounded-2xl border border-border/90 bg-surface/98 dark:bg-zinc-900/98 backdrop-blur-md shadow-2xl p-1.5 space-y-0.5 max-h-64 overflow-y-auto animate-scale-up ${
            isPositionTop ? "bottom-full mb-1.5" : "top-full mt-1.5"
          } ${menuClassName}`}
        >
          {options.length === 0 ? (
            <div className="px-3 py-3 text-center text-xs text-muted-foreground">
              No options available
            </div>
          ) : (
            options.map((opt) => {
              const isSelected = String(opt.value) === String(value);
              const isOptDisabled = Boolean(opt.disabled);
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  disabled={isOptDisabled}
                  onClick={() => !isOptDisabled && handleSelect(opt.value)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left text-xs transition-all ${
                    isOptDisabled
                      ? "opacity-40 cursor-not-allowed text-muted-foreground"
                      : isSelected
                      ? "bg-primary text-primary-foreground font-semibold shadow-2xs cursor-pointer"
                      : "text-foreground hover:bg-surface-muted dark:hover:bg-zinc-800 cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {opt.icon && (
                      <span className={`shrink-0 ${isSelected ? "text-primary-foreground" : "text-primary"}`}>
                        {opt.icon}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate">{opt.label}</span>
                        {opt.badge && (
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                              isSelected
                                ? "bg-white/20 text-white"
                                : opt.badgeColor || "bg-primary/10 text-primary"
                            }`}
                          >
                            {opt.badge}
                          </span>
                        )}
                      </div>
                      {opt.description && (
                        <p
                          className={`text-[10px] truncate ${
                            isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                          }`}
                        >
                          {opt.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="w-3.5 h-3.5 shrink-0 ml-1 text-primary-foreground" />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
