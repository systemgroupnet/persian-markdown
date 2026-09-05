/**
 * The share dialog.
 *
 * Sharing is the moment a document stops being private, so this dialog's job is
 * to make that unmistakable rather than convenient. Two things it must never
 * do: share silently, or imply the resulting link is protected.
 *
 * Sharing COPIES the private document into a new room (PLAN.md §4.6) — the
 * local scratchpad is left untouched, because a scratchpad that vanishes when
 * you share it would be a nasty surprise.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check, Link2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { shareUrl, type RoomLocation } from "@/room/location";

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: RoomLocation;
  /** Mints a room, seeds it with the current text, and navigates to it. */
  onCreateRoom: () => Promise<void> | void;
}

export function ShareDialog({
  open,
  onOpenChange,
  location,
  onCreateRoom,
}: ShareDialogProps) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  // Stale "Copied" feedback from a previous visit would be misleading.
  useEffect(() => {
    if (!open) setCopyState("idle");
  }, [open]);

  const url = location.kind === "shared" ? shareUrl(location.id) : "";

  const handleCopy = useCallback(async () => {
    try {
      // navigator.clipboard is unavailable over plain HTTP on a LAN address,
      // which is exactly how someone would self-host this for a team — so the
      // failure path has to be real, not theoretical.
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2500);
  }, [url]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      await onCreateRoom();
    } finally {
      setCreating(false);
    }
  }, [onCreateRoom]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("share.title")}</DialogTitle>
          {location.kind === "private" && (
            <DialogDescription>{t("share.fromPrivateBody")}</DialogDescription>
          )}
        </DialogHeader>

        {location.kind === "private" ? (
          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={creating}>
              <Link2 aria-hidden="true" className="size-4" />
              {creating ? t("share.creating") : t("share.create")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">{t("share.linkLabel")}</span>
              <span className="flex items-stretch gap-2">
                {/*
                  A room URL is latin text inside an RTL layout: without an
                  explicit dir it reorders on screen and the user copies
                  something that looks wrong. readOnly rather than disabled so
                  it stays selectable for manual copying when the clipboard API
                  is blocked.
                */}
                <input
                  type="text"
                  readOnly
                  dir="ltr"
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-[--radius] border border-border bg-muted px-2 py-1.5 font-mono text-xs"
                  aria-label={t("share.linkLabel")}
                />
                <Button variant="outline" onClick={handleCopy} className="shrink-0">
                  {copyState === "copied" ? (
                    <Check aria-hidden="true" className="size-4" />
                  ) : (
                    <Copy aria-hidden="true" className="size-4" />
                  )}
                  {copyState === "copied" ? t("share.copied") : t("share.copy")}
                </Button>
              </span>
            </label>

            {copyState === "failed" && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("share.copyFailed")}
              </p>
            )}
          </div>
        )}

        {/*
          Shown in both states. There is no auth in this product, so the link
          IS the access control; saying so plainly is the honest design.
        */}
        <p className="flex gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{t("share.accessWarning")}</span>
        </p>
      </DialogContent>
    </Dialog>
  );
}
