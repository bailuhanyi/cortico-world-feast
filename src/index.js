/**
 * 扩展入口：默认导出必须是 WorldDefinition。
 * package.json 里 cortico.kind = world、cortico.api = 6。
 */
import definition, { feastDefinition } from './definition.js';

export default definition;
export { feastDefinition };
export { FeastWorld, FEAST_TOOL_DECLS } from './world.js';
export {
  ID as FEAST_WORLD_ID,
  DEFAULTS as FEAST_DEFAULTS,
  EVENT_FEED,
  EVENT_MEAL,
  EVENT_TABLE,
  EVENT_TOGETHER,
} from './config.js';
export {
  briefLine, filterDishes, findDish, loadDishes, pickFew, pickOne, resetDishCache,
  tasteProfile, TASTE_FIELDS, CATEGORIES,
} from './dishes.js';
export { renderBite, renderProfile, tempClass, POOLS } from './eat.js';
export {
  dayIn, eatenTodayText, eatCount, hmIn, lastEaten, markNudged, newState, nextMealText,
  normalizeState, planTick, recentEaten, recordEat, recordReaction, rollover,
  servedStillFresh, setServed, skipToday, statusLine, parseSlots, minutesIn,
} from './state.js';
