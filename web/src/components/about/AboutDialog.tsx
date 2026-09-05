// About dialog (PLAN.md §7). A shadcn Dialog, strictly monochrome,
// --radius: 2px, 1px borders, Lucide icons only, no emoji. Content: project
// name + one-line description; MIT license / systemgroupnet attribution
// with a repository link; version + commit (injected via props, built at
// build time — never invented here); the Vazirmatn SIL OFL attribution;
// credit to Rustpad for the collaboration design; and a plain statement
// that shared rooms are unlisted/unguessable but not secret.
import * as React from "react";
import { ExternalLink as ExternalLinkIcon, KeyRound, Type } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { GitHubMark } from "./GitHubMark";
import { aboutStrings, type AboutDictionary } from "./strings";

export interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Build version, e.g. injected via `-ldflags` / a build-time define. Never invented at runtime. */
  version: string;
  /** Build commit hash/short-SHA, injected the same way as `version`. */
  commit: string;
  locale: "fa" | "en";
}

const REPO_URL = "https://github.com/systemgroupnet";
const VAZIRMATN_URL = "https://github.com/rastikerdar/vazirmatn";
const RUSTPAD_URL = "https://github.com/ekzhang/rustpad";

/**
 * An `<a>` that is keyboard accessible with a visible focus ring, opens in
 * a new tab safely, and wraps a Latin URL/label in `dir="ltr"` so it does
 * not visually reorder inside the surrounding Persian RTL layout.
 */
function ExternalLink({
  href,
  children,
  icon = true,
}: {
  href: string;
  children: React.ReactNode;
  icon?: boolean;
}): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      dir="ltr"
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius)] underline underline-offset-2 outline-none",
        "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span>{children}</span>
      {icon ? <ExternalLinkIcon className="size-3.5 shrink-0" strokeWidth={1.5} /> : null}
    </a>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      <div className="text-sm text-foreground">{children}</div>
    </section>
  );
}

export function AboutDialog({
  open,
  onOpenChange,
  version,
  commit,
  locale,
}: AboutDialogProps): React.JSX.Element {
  const strings: AboutDictionary = aboutStrings[locale];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-5">
        <DialogHeader>
          <DialogTitle>{strings.title}</DialogTitle>
          <DialogDescription>{strings.tagline}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Section heading={strings.repositoryLinkLabel}>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>{strings.licenseLead}</span>
              <ExternalLink href={REPO_URL} icon={false}>
                {strings.authorName}
              </ExternalLink>
              <span aria-hidden="true">·</span>
              <GitHubMark className="size-3.5 shrink-0 text-muted-foreground" />
              <ExternalLink href={REPO_URL}>{strings.repositoryLinkLabel}</ExternalLink>
            </p>
          </Section>

          <div className="flex items-center gap-4 text-sm" dir="ltr">
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <Type className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
              <span className="text-muted-foreground">{strings.versionLabel}:</span>
              <span className="font-mono">{version}</span>
            </span>
            <Separator orientation="vertical" className="h-4" />
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <span className="text-muted-foreground">{strings.commitLabel}:</span>
              <span className="font-mono">{commit}</span>
            </span>
          </div>

          <Separator />

          <Section heading={strings.fontHeading}>
            <p>
              {strings.fontAttribution}{" "}
              <ExternalLink href={VAZIRMATN_URL}>{strings.fontLinkLabel}</ExternalLink>
            </p>
          </Section>

          <Section heading={strings.collaborationHeading}>
            <p>
              {strings.collaborationAttribution}{" "}
              <ExternalLink href={RUSTPAD_URL}>{strings.rustpadLinkLabel}</ExternalLink>
            </p>
          </Section>

          <Separator />

          <Section heading={strings.privacyHeading}>
            <p className="flex items-start gap-2 text-muted-foreground">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} />
              <span>{strings.privacyNotice}</span>
            </p>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
