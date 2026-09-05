// UI strings owned by the About dialog. Deliberately NOT part of
// web/src/i18n/** (see the build brief for this module — several agents
// touch i18n in parallel) — this module is self-contained and renders its
// own bilingual copy directly, without going through useI18n()/t().
//
// Keys:
//   title                  — dialog title (project name).
//   tagline                — one-line description.
//   licenseLead             — "Open source, MIT-licensed, by" (name + link follow).
//   authorName              — "systemgroupnet".
//   repositoryLinkLabel     — link text to the repository.
//   versionLabel            — label before the injected version string.
//   commitLabel             — label before the injected commit hash.
//   fontHeading             — small heading above the font attribution.
//   fontAttribution         — Vazirmatn / SIL OFL attribution sentence.
//   fontLinkLabel           — link text to the Vazirmatn repository.
//   collaborationHeading    — small heading above the Rustpad credit.
//   collaborationAttribution — Rustpad credit sentence.
//   rustpadLinkLabel        — link text to the Rustpad repository.
//   privacyHeading          — small heading above the privacy note.
//   privacyNotice           — "rooms are unlisted/unguessable, not secret" statement.
export interface AboutDictionary {
  title: string;
  tagline: string;
  licenseLead: string;
  authorName: string;
  repositoryLinkLabel: string;
  versionLabel: string;
  commitLabel: string;
  fontHeading: string;
  fontAttribution: string;
  fontLinkLabel: string;
  collaborationHeading: string;
  collaborationAttribution: string;
  rustpadLinkLabel: string;
  privacyHeading: string;
  privacyNotice: string;
}

export const aboutStrings: Record<"fa" | "en", AboutDictionary> = {
  fa: {
    title: "ویرایشگر مارک‌داون فارسی",
    tagline: "ویرایشگر مشترکِ بلادرنگِ مارک‌داون، راست‌چین‌شده از پایه.",
    licenseLead: "نرم‌افزار متن‌باز با مجوز MIT، ساخته‌ی",
    authorName: "systemgroupnet",
    repositoryLinkLabel: "مخزن کد در گیت‌هاب",
    versionLabel: "نسخه",
    commitLabel: "کامیت",
    fontHeading: "فونت",
    fontAttribution: "فونت وزیرمتن (Vazirmatn) با مجوز SIL Open Font License استفاده شده است.",
    fontLinkLabel: "مخزن وزیرمتن",
    collaborationHeading: "هم‌کاری زنده",
    collaborationAttribution:
      "طراحی هم‌کاریِ بلادرنگ از پروژه‌ی Rustpad الهام گرفته شده است.",
    rustpadLinkLabel: "مخزن Rustpad",
    privacyHeading: "درباره‌ی حریم خصوصی اتاق‌ها",
    privacyNotice:
      "شناسه‌ی اتاق‌های اشتراکی تصادفی و عملاً غیرقابل‌حدس است، اما محرمانه نیست: این ابزار هیچ حساب کاربری یا ورودی ندارد، پس هرکسی که پیوند اتاق را داشته باشد می‌تواند سند را ببیند و ویرایش کند.",
  },
  en: {
    title: "Persian Markdown Editor",
    tagline: "A real-time collaborative markdown editor, RTL from the ground up.",
    licenseLead: "Open-source software under the MIT license, built by",
    authorName: "systemgroupnet",
    repositoryLinkLabel: "Repository on GitHub",
    versionLabel: "Version",
    commitLabel: "Commit",
    fontHeading: "Font",
    fontAttribution: "Uses the Vazirmatn font, licensed under the SIL Open Font License.",
    fontLinkLabel: "Vazirmatn repository",
    collaborationHeading: "Live collaboration",
    collaborationAttribution: "The real-time collaboration design is inspired by the Rustpad project.",
    rustpadLinkLabel: "Rustpad repository",
    privacyHeading: "About room privacy",
    privacyNotice:
      "Shared room IDs are random and effectively unguessable, but they are not secret: this tool has no accounts or sign-in, so anyone with a room's link can view and edit the document.",
  },
};
