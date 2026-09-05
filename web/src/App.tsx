import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import {
  Code2,
  Columns2,
  Eye,
  Info,
  Languages,
  Link2,
  Save,
  FileCode2,
  HardDrive,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n, type Locale } from "@/i18n";

import { AboutDialog } from "@/components/about/AboutDialog";
import { ShareDialog } from "@/components/share/ShareDialog";
import { Presence } from "@/app/Presence";
import { useCollabDocument } from "@/app/useCollabDocument";
import { useRoomLocation } from "@/app/useRoomLocation";
import { goToRoom, mintRoomId } from "@/room/location";
import { stashSeed } from "@/room/seed";
import { saveMarkdown, exportDocumentAsHtml } from "@/export";
import { SourceView } from "@/views/source";
import type { NormalizationPreview } from "@/views/wysiwyg/WysiwygView";

/**
 * The preview pipeline (react-markdown plus the whole remark/rehype stack) is
 * only reachable from split view, so it streams in rather than sitting in the
 * entry chunk. Split is the default view, so this does not avoid the download
 * — it makes the editor interactive while the renderer is still arriving,
 * which is the half users type into first.
 */
const SplitView = lazy(() =>
  import("@/views/split/SplitView").then((m) => ({ default: m.SplitView })),
);

/**
 * Plate and Slate are the single largest dependency in the app, and most
 * sessions never leave source or split view. Loading the WYSIWYG editor on
 * demand keeps it out of the entry chunk — with it statically imported the
 * first paint pulled 537 KB gzipped, well past the plan's 250 KB budget.
 */
const WysiwygView = lazy(() =>
  import("@/views/wysiwyg/WysiwygView").then((m) => ({ default: m.WysiwygView })),
);

type ViewMode = "source" | "split" | "wysiwyg";

const VIEW_MODES: ReadonlyArray<{ value: ViewMode; icon: typeof Code2 }> = [
  { value: "source", icon: Code2 },
  { value: "split", icon: Columns2 },
  { value: "wysiwyg", icon: Eye },
];

const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";
const COMMIT = import.meta.env.VITE_APP_COMMIT ?? "unknown";

export function App() {
  const { t, locale, setLocale } = useI18n();
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [shareOpen, setShareOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [normalization, setNormalization] = useState<NormalizationPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const location = useRoomLocation();
  const doc = useCollabDocument(location);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "fa" ? ("en" as Locale) : ("fa" as Locale));
  }, [locale, setLocale]);

  /**
   * Sharing COPIES the private document into a new room and navigates there;
   * the local scratchpad is deliberately left untouched (PLAN.md §4.6).
   *
   * The text is captured before navigating because the hash change tears down
   * the private session and builds a new one.
   */
  const handleCreateRoom = useCallback(() => {
    const id = mintRoomId();
    // Stash before navigating: the hash change tears down the private session
    // and builds the shared one, and useCollabDocument applies the seed to
    // that new session once it has a baseline.
    stashSeed(id, doc.text);
    goToRoom(id);
    setShareOpen(false);
  }, [doc.text]);

  const handleSaveMarkdown = useCallback(async () => {
    setBusy(true);
    try {
      await saveMarkdown(doc.text);
    } finally {
      setBusy(false);
    }
  }, [doc.text]);

  /**
   * The HTML renderer is imported dynamically on purpose: it statically pulls
   * in KaTeX's stylesheet text, and a static import here would drag that into
   * the main bundle for every user who never exports.
   */
  const handleExportHtml = useCallback(async () => {
    setBusy(true);
    try {
      const { renderToHtml, previewCss } = await import("@/markdown/renderToHtml");
      const { html } = await renderToHtml(doc.text);
      await exportDocumentAsHtml({
        bodyHtml: html,
        css: previewCss,
        title: t("appName"),
        locale,
        embedFont: true,
      });
    } finally {
      setBusy(false);
    }
  }, [doc.text, locale, t]);

  const editor = useMemo(
    () => (
      <SourceView
        value={doc.text}
        onChange={doc.applyChange}
        onSelectionChange={doc.setSelection}
        remoteCursors={doc.remoteCursors}
        locale={locale}
      />
    ),
    [doc.text, doc.applyChange, doc.setSelection, doc.remoteCursors, locale],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <header className="flex items-center gap-3 border-b border-border px-4 py-2">
          <span className="text-sm font-medium">{t("appName")}</span>

          <Separator orientation="vertical" className="h-5" />

          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(value) => {
              if (value) setViewMode(value as ViewMode);
            }}
            size="sm"
            aria-label={t("viewMode.groupLabel")}
          >
            {VIEW_MODES.map(({ value, icon: Icon }) => (
              <Tooltip key={value}>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value={value} aria-label={t(`viewMode.${value}` as const)}>
                    <Icon className="size-4" strokeWidth={1.5} />
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{t(`viewMode.${value}` as const)}</TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>

          {/*
            The private badge states the guarantee rather than hinting at it.
            The failure mode worth designing against is someone typing
            something sensitive into what they only assume is private.
          */}
          {location.kind === "private" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1.5 border border-border px-2 py-1 text-xs text-muted-foreground">
                  <HardDrive className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                  {t("badge.local")}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{t("badge.localDescription")}</TooltipContent>
            </Tooltip>
          )}

          <div className="ms-auto flex items-center gap-2">
            {location.kind === "shared" && (
              <Presence peers={doc.peers} selfId={doc.selfId} status={doc.status} />
            )}

            <HeaderButton
              icon={Link2}
              label={t("actions.share")}
              onClick={() => setShareOpen(true)}
            />
            <HeaderButton
              icon={Save}
              label={t("actions.saveMarkdown")}
              onClick={handleSaveMarkdown}
              disabled={busy}
            />
            <HeaderButton
              icon={FileCode2}
              label={t("actions.exportHtml")}
              onClick={handleExportHtml}
              disabled={busy}
            />
            <HeaderButton
              icon={Info}
              label={t("actions.about")}
              onClick={() => setAboutOpen(true)}
            />
            <HeaderButton icon={Languages} label={t("locale.toggle")} onClick={toggleLocale} />
          </div>
        </header>

        <main className="relative flex-1 overflow-hidden">
          {viewMode === "source" && editor}

          {viewMode === "split" && (
            <Suspense fallback={editor}>
              <SplitView markdown={doc.text} locale={locale}>
                {editor}
              </SplitView>
            </Suspense>
          )}

          {viewMode === "wysiwyg" && (
            <Suspense fallback={<div className="h-full" aria-busy="true" />}>
              <WysiwygView
                value={doc.text}
                onChange={doc.applyChange}
                locale={locale}
                onNormalizationRequired={setNormalization}
              />
            </Suspense>
          )}
        </main>
      </div>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        location={location}
        onCreateRoom={handleCreateRoom}
      />

      <AboutDialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        version={VERSION}
        commit={COMMIT}
        locale={locale}
      />

      <NormalizationDialog
        preview={normalization}
        onResolved={() => setNormalization(null)}
        onCancelled={() => setViewMode("source")}
      />
    </TooltipProvider>
  );
}


function HeaderButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Code2;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
          <Icon className="size-4" strokeWidth={1.5} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Entering WYSIWYG can reformat a document that round-trips imperfectly
 * (`_em_` becomes `*em*`, setext headings become ATX). Doing that silently
 * would emit one operation rewriting the whole document over everyone else's
 * work, so the rewrite is only ever an explicit, attributable user action —
 * PLAN.md §5.3, hazard one. Declining returns to source view, where the
 * original formatting is preserved exactly.
 */
function NormalizationDialog({
  preview,
  onResolved,
  onCancelled,
}: {
  preview: NormalizationPreview | null;
  onResolved: () => void;
  onCancelled: () => void;
}) {
  const { t } = useI18n();
  if (!preview) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          preview.cancel();
          onResolved();
          onCancelled();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("normalization.title")}</DialogTitle>
          <DialogDescription>{t("normalization.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              preview.cancel();
              onResolved();
              onCancelled();
            }}
          >
            {t("normalization.stayInSource")}
          </Button>
          <Button
            onClick={() => {
              preview.confirm();
              onResolved();
            }}
          >
            {t("normalization.normalize")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
