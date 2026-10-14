/**
 * framer-motion feature bundle, loaded on demand by `LazyMotion`.
 *
 * Kept in its own module so the animation/gesture/layout engine is split into
 * a separate chunk that downloads after the first render instead of blocking
 * it. `domMax` (rather than `domAnimation`) is needed because some components
 * use the `layout` prop.
 */
import { domMax } from 'framer-motion';

export default domMax;
