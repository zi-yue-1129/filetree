import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { apiRequest, wsUrl as buildWsUrl } from '../services/api';
import { isMobileNative, onUploadProgress } from '../native';
import type { PluginListenerHandle } from '@capacitor/core';
import type { UserDashboardData } from '../types/dashboard';

/**
 * Report whether this browser session already unlocked the given account.
 *
 * Args:
 *   username: Account whose `unlocked_<username>` sessionStorage flag is read.
 *
 * Returns:
 *   True when the session flag is set to 'true'.
 */
function isSessionUnlocked(username: string | undefined): boolean {
  return Boolean(
    username &&
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(`unlocked_${username}`) === 'true'
  );
}

export function useUserDashboard(initialData: UserDashboardData) {
  const { token, isAuthenticated: authAuthenticated, user: loggedInUser, login, logout } = useAuth();
  const [dashboardData, setDashboardData] = useState<UserDashboardData>(initialData);
  const [password, setPassword] = useState("");
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);
  const targetUsername = initialData.user?.username;

  // Check if current logged in user is the owner of this page
  const isPageOwner = useMemo(() => {
    return loggedInUser?.username === targetUsername;
  }, [loggedInUser?.username, targetUsername]);

  // Local isAuthenticated state
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (authAuthenticated && isPageOwner) return true;
    // Session fallback
    return isSessionUnlocked(targetUsername);
  });

  // Sync auth state. The owner of this page is unlocked either by an active
  // login or by this session's unlock flag; non-owners keep the local state.
  // Adjusting state while rendering (instead of in an effect) avoids an extra
  // cascading render, see https://react.dev/learn/you-might-not-need-an-effect.
  const ownerUnlocked =
    isPageOwner && (authAuthenticated || isSessionUnlocked(targetUsername));
  if (ownerUnlocked && !isAuthenticated) {
    setIsAuthenticated(true);
  }

  // Persist the owner's unlock for this browser session (external system).
  useEffect(() => {
    if (isPageOwner && authAuthenticated && targetUsername) {
      sessionStorage.setItem(`unlocked_${targetUsername}`, 'true');
    }
  }, [isPageOwner, authAuthenticated, targetUsername]);

  // Reset data when the page switches to a different account.
  if (targetUsername !== dashboardData.user?.username) {
    setDashboardData(initialData);
  }

  const refreshDashboard = useCallback(async (authToken?: string | null) => {
    try {
      const sendToken = authToken || (isAuthenticated ? token : null);
      // Only request if we have a username
      if (!targetUsername) return;

      const newData = await apiRequest(`/user/${targetUsername}`, {
        token: sendToken
      });
      setDashboardData(newData);
    } catch (err) {
      console.error("Failed to refresh dashboard:", err);
    }
  }, [targetUsername, token, isAuthenticated]);

  // WebSocket
  const wsUrl = useMemo(() => {
    if (!targetUsername) return null;
    let url = buildWsUrl(`/api/ws/${targetUsername}`);
    if (token) url += `?token=${token}`;
    return url;
  }, [targetUsername, token]);

  const handleWebSocketMessage = useCallback((event: MessageEvent) => {
    if (event.data === "REFRESH") {
      console.log("[useUserDashboard] Received REFRESH signal");
      refreshDashboard(token);
    }
  }, [refreshDashboard, token]);

  // Native apps: a background upload may finish while the WebSocket is down
  // (app in background, socket dropped). The server indexes the file before
  // acknowledging the last chunk, so a completed job means "refetch now".
  useEffect(() => {
    if (!isMobileNative()) return undefined;
    let handle: PluginListenerHandle | null = null;
    let disposed = false;
    onUploadProgress((event) => {
      if (event.state === 'completed') void refreshDashboard(token);
    })
      .then((created) => {
        if (disposed) void created.remove();
        else handle = created;
      })
      .catch((error: unknown) => console.error('Failed to subscribe to native upload progress', error));
    return () => {
      disposed = true;
      if (handle) void handle.remove();
    };
  }, [refreshDashboard, token]);

  const { isConnected } = useWebSocket(wsUrl, {
    onMessage: handleWebSocketMessage,
    reconnectInterval: 3000,
    maxRetries: 20
  });

  return {
    dashboardData,
    setDashboardData,
    isAuthenticated,
    setIsAuthenticated,
    password,
    setPassword,
    isPageOwner,
    refreshDashboard,
    isBatchSyncing,
    setIsBatchSyncing,
    token,
    login,
    logout,
    isConnected
  };
}
