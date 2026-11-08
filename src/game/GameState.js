/**
 * Super Kart 3D.js — global game state machine.
 * States: BOOT -> MENU -> COUNTDOWN -> RACE -> FINISHED -> (MENU | RESTART)
 *
 * The state machine is event-driven: enter(state, payload) is called on
 * transitions and the current state is always readable via getState().
 * Game systems (loop, input, HUD, audio) subscribe to transitions.
 */

export const STATES = {
  BOOT: 'boot',
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  RACE: 'race',
  PAUSED: 'paused',
  FINISHED: 'finished',
};

const LISTENERS = new Set();

let currentState = STATES.BOOT;
let payload = {};

export function setState(next, data = {}) {
  if (next === currentState) return;
  const prev = currentState;
  currentState = next;
  payload = data;
  for (const fn of LISTENERS) {
    try {
      fn(next, prev, data);
    } catch (err) {
      // A failing listener must never break the state machine.
      console.error('[GameState] listener error', err);
    }
  }
}

export function getState() {
  return currentState;
}

export function getPayload() {
  return payload;
}

/** Subscribe to transitions: fn(nextState, prevState, payload). Returns unsubscribe. */
export function onStateChange(fn) {
  LISTENERS.add(fn);
  return () => LISTENERS.delete(fn);
}
