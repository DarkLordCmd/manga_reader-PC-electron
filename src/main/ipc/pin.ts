import { z } from 'zod';
import { CH } from '../../shared/ipc';
import type { PinService } from '../services/pin';
import { handleSafe } from './validate';

/** Same rule as PinService: 6–8 digits, no control characters. */
const pinArg = z.string().min(6).max(8).regex(/^\d+$/, 'PIN должен быть 6–8 цифр');
/** Legacy profiles may still have a 4–5 digit PIN: verifying/removing must accept
 * it (the service decides), otherwise the lock could never be opened/removed. */
const anyPin = z.string().min(1).max(8).regex(/^\d+$/, 'PIN должен быть 4–8 цифр');

export function registerPin(deps: { pin: PinService }): void {
  handleSafe(CH.pinHasPin, z.tuple([]), () => deps.pin.hasPin());
  handleSafe(CH.pinSetPin, z.tuple([pinArg, z.string().max(8).optional()]), (_e, p: string, current?: string) =>
    deps.pin.setPin(p, current),
  );
  handleSafe(CH.pinRemovePin, z.tuple([anyPin]), (_e, p) => deps.pin.removePin(p));
  handleSafe(CH.pinVerifyPin, z.tuple([anyPin]), (_e, p) => deps.pin.verify(p));
  handleSafe(CH.pinFailedAttempt, z.tuple([]), () => deps.pin.failedAttempt());
}
