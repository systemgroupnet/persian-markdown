import { useEffect, useState } from "react";

import { currentLocation, onLocationChange, type RoomLocation } from "@/room/location";

/**
 * The room this browser is looking at, kept in step with the URL hash.
 *
 * Reading through useState's initialiser rather than an effect means the very
 * first render already knows whether this is the private document or a shared
 * room — otherwise the app would briefly mount a private session, tear it down,
 * and open a socket, which shows up as a visible flash and a wasted connection.
 */
export function useRoomLocation(): RoomLocation {
  const [location, setLocation] = useState<RoomLocation>(() => currentLocation());

  useEffect(() => onLocationChange(setLocation), []);

  return location;
}
