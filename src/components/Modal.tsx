"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  className?: string;
}

function useDialogBehavior(
  open: boolean,
  onClose: () => void,
  closeRef: RefObject<HTMLButtonElement | null>,
  dialogRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [closeRef, dialogRef, onClose, open]);
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
  const dialogRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  useDialogBehavior(open, onClose, closeRef, dialogRef);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-layer"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
        >
          <motion.button
            className="modal-backdrop"
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
          />
          <motion.section
            ref={dialogRef}
            className={"retro-modal " + className}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 10, scale: 0.99 }
            }
            transition={{
              duration: reduceMotion ? 0 : 0.2,
              ease: "easeOut",
            }}
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
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
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
  const dialogRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  useDialogBehavior(open, onClose, closeRef, dialogRef);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-layer mobile-sheet-layer"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
        >
          <motion.button
            className="modal-backdrop"
            type="button"
            aria-label="Close panel"
            onClick={onClose}
          />
          <motion.section
            ref={dialogRef}
            className="mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={reduceMotion ? false : { y: "100%" }}
            animate={{ y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            transition={{
              duration: reduceMotion ? 0 : 0.26,
              ease: [0.22, 1, 0.36, 1],
            }}
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
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
