import React from 'react';
import { MOBILE_CONTENT_TOP_INSET } from './mobileChromeLayout';

/**
 * Empty block at the top of the phone dashboard's scroll content: reserves
 * the room of the floating chrome (button row, name, breadcrumb) so that at
 * scroll-top no card is covered; scrolling moves cards up underneath it.
 *
 * @returns The spacer.
 */
export const MobileTopSpacer: React.FC = () => (
  <div aria-hidden="true" className="shrink-0 lg:hidden" style={{ height: MOBILE_CONTENT_TOP_INSET }} />
);
