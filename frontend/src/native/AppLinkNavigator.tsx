/**
 * Invisible, eagerly loaded router child that applies App Links received
 * while the app runs (see `appLinks.ts`). Kept tiny and free of Capacitor
 * imports so it can mount with the router instead of with lazy chunks.
 */
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeAppLinks } from './appLinkBus';

/**
 * Subscribes the router to incoming App Links; renders nothing.
 *
 * @returns `null`.
 */
export const AppLinkNavigator: React.FC = () => {
  const navigate = useNavigate();

  useEffect(
    () => subscribeAppLinks((path: string) => {
      const { pathname, search, hash } = window.location;
      // The launch link may also arrive as an event; do not stack duplicates.
      if (path !== `${pathname}${search}${hash}`) navigate(path);
    }),
    [navigate],
  );

  return null;
};
