/**
 * Restrained monochrome toolbar. `--radius: 2px`, 1px borders, no shadows,
 * no colour, no emoji — matching web/src/styles/theme.css. Logical spacing
 * only (`gap`, `ps-`/`pe-` where directional padding is needed) so the bar
 * mirrors correctly when the UI locale flips to `rtl`.
 */
import * as React from "react";
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table2,
} from "lucide-react";
import type { PlateEditor } from "platejs/react";

import { cn } from "@/lib/utils";

import { toggleList } from "./list-commands";
import type { WysiwygStrings } from "./strings";

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ label, active, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Mousedown (not click) so the editor's selection never loses focus
      // before the command runs — standard Slate/Plate toolbar pattern.
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-[var(--radius)] text-foreground transition-colors",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        active && "bg-foreground text-background hover:bg-foreground",
      )}
      title={label}
    >
      {children}
    </button>
  );
}

export interface WysiwygToolbarProps {
  editor: PlateEditor;
  strings: WysiwygStrings;
  disabled?: boolean;
  /** Bumped on every selection/value change so mark/block "active" state
   * recomputes — Plate's editor object is mutable, not itself reactive. */
  updateSignal: number;
}

const ICON_SIZE = 16;
const ICON_STROKE = 1.5;

export function WysiwygToolbar({ editor, strings, disabled, updateSignal }: WysiwygToolbarProps) {
  // `updateSignal` intentionally participates in no logic beyond forcing a
  // re-render on selection/value change, so these reads reflect current state.
  void updateSignal;

  const marks = (editor.api.marks() ?? {}) as Record<string, unknown>;
  const blockEntry = editor.api.block();
  const blockNode = blockEntry?.[0] as { type?: string; listStyleType?: string } | undefined;

  const isMarkActive = (key: string) => Boolean(marks[key]);
  const isBlockActive = (type: string) => blockNode?.type === type;
  const isListActive = (style: string) => blockNode?.type === "p" && blockNode.listStyleType === style;

  const toggleMark = (key: string) => editor.tf.toggleMark(key);
  const toggleBlock = (type: string) => editor.tf.toggleBlock(type);

  const insertLink = () => {
    const url = window.prompt(strings.linkPrompt.url, "https://");
    if (!url) return;
    if (editor.selection && !editor.api.isCollapsed()) {
      editor.tf.wrapNodes({ type: "a", url, children: [] }, { split: true });
    } else {
      editor.tf.insertNodes({ type: "a", url, children: [{ text: url }] });
    }
  };

  const insertTable = () => {
    const cell = () => ({ type: "td", children: [{ type: "p", children: [{ text: "" }] }] });
    const headerCell = () => ({ type: "th", children: [{ type: "p", children: [{ text: "" }] }] });
    editor.tf.insertNodes({
      type: "table",
      children: [
        { type: "tr", children: [headerCell(), headerCell()] },
        { type: "tr", children: [cell(), cell()] },
      ],
    });
  };

  const insertHr = () => {
    editor.tf.insertNodes({ type: "hr", children: [{ text: "" }] });
  };

  return (
    <div
      role="toolbar"
      aria-label="WYSIWYG formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border bg-background p-1"
    >
      <ToolbarButton label={strings.toolbar.bold} active={isMarkActive("bold")} disabled={disabled} onClick={() => toggleMark("bold")}>
        <Bold size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
      <ToolbarButton label={strings.toolbar.italic} active={isMarkActive("italic")} disabled={disabled} onClick={() => toggleMark("italic")}>
        <Italic size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
      <ToolbarButton
        label={strings.toolbar.strikethrough}
        active={isMarkActive("strikethrough")}
        disabled={disabled}
        onClick={() => toggleMark("strikethrough")}
      >
        <Strikethrough size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>

      <Separator />

      <ToolbarButton label={strings.toolbar.heading1} active={isBlockActive("h1")} disabled={disabled} onClick={() => toggleBlock("h1")}>
        <Heading1 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
      <ToolbarButton label={strings.toolbar.heading2} active={isBlockActive("h2")} disabled={disabled} onClick={() => toggleBlock("h2")}>
        <Heading2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
      <ToolbarButton label={strings.toolbar.heading3} active={isBlockActive("h3")} disabled={disabled} onClick={() => toggleBlock("h3")}>
        <Heading3 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>

      <Separator />

      <ToolbarButton
        label={strings.toolbar.bulletList}
        active={isListActive("disc")}
        disabled={disabled}
        onClick={() => toggleList(editor, "disc")}
      >
        <List size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
      <ToolbarButton
        label={strings.toolbar.orderedList}
        active={isListActive("decimal")}
        disabled={disabled}
        onClick={() => toggleList(editor, "decimal")}
      >
        <ListOrdered size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
      <ToolbarButton
        label={strings.toolbar.taskList}
        active={isListActive("todo")}
        disabled={disabled}
        onClick={() => toggleList(editor, "todo")}
      >
        <ListChecks size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>

      <Separator />

      <ToolbarButton label={strings.toolbar.link} active={isBlockActive("a")} disabled={disabled} onClick={insertLink}>
        <Link2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
      <ToolbarButton label={strings.toolbar.blockquote} active={isBlockActive("blockquote")} disabled={disabled} onClick={() => toggleBlock("blockquote")}>
        <Quote size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
      <ToolbarButton label={strings.toolbar.codeBlock} active={isBlockActive("code_block")} disabled={disabled} onClick={() => toggleBlock("code_block")}>
        <Code2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
      <ToolbarButton label={strings.toolbar.table} disabled={disabled} onClick={insertTable}>
        <Table2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
      <ToolbarButton label={strings.toolbar.horizontalRule} disabled={disabled} onClick={insertHr}>
        <Minus size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </ToolbarButton>
    </div>
  );
}

function Separator() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />;
}
