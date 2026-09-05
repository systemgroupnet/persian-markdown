// English dictionary. Keys must match fa.ts exactly — enforced by
// `satisfies Dictionary`.
import type { Dictionary } from "./index";

export const en = {
  appName: "Persian Markdown Editor",

  viewMode: {
    groupLabel: "View mode",
    source: "Source",
    split: "Split",
    wysiwyg: "WYSIWYG",
  },

  actions: {
    saveMarkdown: "Save as Markdown",
    exportHtml: "Export HTML",
    share: "Share",
    about: "About",
  },

  badge: {
    local: "Local",
    localDescription: "This document is stored only on this device and is never sent to a server.",
  },

  normalization: {
    title: "Normalize formatting",
    body: "Entering visual editing will normalize this document's formatting — for example _emphasis_ becomes *emphasis*. The change applies for everyone in the room.",
    normalize: "Normalize and continue",
    stayInSource: "Stay in source view",
  },

  share: {
    title: "Share this document",
    fromPrivateBody:
      "A new room is created and the current text is copied into it. Your local document is left untouched.",
    create: "Create share link",
    creating: "Creating…",
    linkLabel: "Room link",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Could not copy. Select the link and copy it manually.",
    accessWarning:
      "Anyone with this link can read and edit the document. There are no accounts and no password.",
    backToPrivate: "Back to the local document",
  },

  connection: {
    connecting: "Connecting…",
    connected: "Connected",
    disconnected: "Disconnected",
    reconnecting: "Reconnecting…",
  },

  locale: {
    toggle: "Language",
    fa: "فارسی",
    en: "English",
  },
} satisfies Dictionary;
