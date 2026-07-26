import type { EventEmitter } from "events";

/**
 * Each connected player subscribes to the game, chat and proposal emitters, so
 * the listener count tracks concurrent players. Node's default ceiling of 10
 * is meant to catch listeners that are added and never removed, but here it
 * just fires as soon as an eleventh person is online.
 *
 * Verified not to be a leak: 15 clients add exactly 15 listeners, and the count
 * returns to zero on both clean disconnects and abrupt drops.
 *
 * Deliberately not unlimited. This is far above any plausible number of
 * simultaneous players, so the warning still means something has genuinely gone
 * wrong rather than that the game got popular.
 */
const MAX_CONCURRENT_SUBSCRIBERS = 1000;

export function setMaxListenersForConnections(emitter: EventEmitter): void {
  emitter.setMaxListeners(MAX_CONCURRENT_SUBSCRIBERS);
}
