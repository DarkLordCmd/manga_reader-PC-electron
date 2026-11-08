import { z } from 'zod';
import { CH } from '../../shared/ipc';
import type { EhLimitWatcher } from '../services/eh-limits';
import { handleSafe } from './validate';

export function registerEhLimits(deps: { ehWatcher: EhLimitWatcher }): void {
  handleSafe(CH.ehLimitsState, z.tuple([]), () => deps.ehWatcher.state());
}
