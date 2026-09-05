import { cursorColor, type Peer } from "@/collab";
import type { ConnectionStatus } from "@/collab";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";

export interface PresenceProps {
  peers: Peer[];
  selfId: number | null;
  status: ConnectionStatus;
}

const STATUS_KEY = {
  connecting: "connection.connecting",
  connected: "connection.connected",
  reconnecting: "connection.reconnecting",
  offline: "connection.disconnected",
  local: "connection.connected",
} as const;

/**
 * Who else is in the room.
 *
 * Each participant is a 2px square — not a circle, per the design system — and
 * carries their assigned Persian animal name. The hue is the ONLY colour in
 * the entire product; everything else is the neutral ramp. It earns its place
 * because it is pure information: it is what ties a name in this list to a
 * caret in the document.
 */
export function Presence({ peers, selfId, status }: PresenceProps) {
  const { t } = useI18n();

  const others = peers.filter((peer) => peer.id !== selfId && peer.info !== null);
  const connected = status === "connected" || status === "local";

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="size-2 shrink-0 border border-border"
            style={{ background: connected ? "var(--foreground)" : "transparent" }}
            role="status"
            aria-label={t(STATUS_KEY[status])}
          />
        </TooltipTrigger>
        <TooltipContent>{t(STATUS_KEY[status])}</TooltipContent>
      </Tooltip>

      <ul className="flex items-center gap-1" aria-label={t("connection.connected")}>
        {others.map((peer) => (
          <li key={peer.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                {/*
                  The square carries the participant's hue; the name is text,
                  never baked into an image, so it stays selectable and
                  screen-reader legible. Persian names are RTL — dir="auto"
                  keeps a mixed list from reordering.
                */}
                <span
                  className="block size-4 border border-border"
                  style={{ background: cursorColor(peer.info!.hue) }}
                  aria-label={peer.info!.name}
                />
              </TooltipTrigger>
              <TooltipContent dir="auto">{peer.info!.name}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}
