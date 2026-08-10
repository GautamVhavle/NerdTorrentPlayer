"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  className?: string;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  className = "",
}: ModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-layer" role="presentation">
      <button
        className="modal-backdrop"
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <section
        className={"retro-modal " + className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">SYSTEM WINDOW</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </div>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}

interface SheetProps extends ModalProps {
  eyebrow?: string;
}

export function MobileSheet({
  open,
  title,
  onClose,
  children,
  eyebrow = "CONTROL PANEL",
}: SheetProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-layer mobile-sheet-layer" role="presentation">
      <button
        className="modal-backdrop"
        type="button"
        aria-label="Close panel"
        onClick={onClose}
      />
      <section
        className="mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="modal-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            aria-label="Close panel"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </div>
        <div className="sheet-content">{children}</div>
      </section>
    </div>
  );
}

