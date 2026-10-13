import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { apiRequest, wsUrl as buildWsUrl } from '../services/api';
import type { UserDashboardData } from '../types/dashboard';

export function useUserDashboard(initialData: UserDashboardData) {
  const { token, isAuthenticated: authAuthenticated, user: loggedInUser, login, logout } = useAuth();
  const [dashboardData, setDashboardData] = useState<UserDashboardData>(initialData);
  const [password, setPassword] = useState("");
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);

  // Check if current logged in user is the owner of this page
  const isPageOwner = useMemo(() => {
    return loggedInUser?.username === initialData.user?.username;
  }, [loggedInUser?.username, initialData.user?.username]);

  // Local isAuthenticated state
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (authAuthenticated && isPageOwner) return true;
    
    // Session fallback
    const targetUser = initialData?.user?.username;
    if (targetUser && typeof sessionStorage !== 'undefined' && sessionStorage.getItem(`unlocked_${targetUser}`) === 'true') {
      return true;
    }
    return false;
  });

  const refreshDashboard = useCallback(async (authToken?: string | null) => {
    try {
      const sendToken = authToken || (isAuthenticated ? token : null);
      // Only request if we have a username
      if (!initialData.user?.username) return;
      
      const newData = await apiRequest(`/user/${initialData.user?.username}`, { 
        token: sendToken 
      });
      setDashboardData(newData);
    } catch (err) {
      console.error("Failed to refresh dashboard:", err);
    }
  }, [initialData.user?.username, token, isAuthenticated]);

  // Sync auth state
  useEffect(() => {
    if (isPageOwner && authAuthenticated) {
      if (!isAuthenticated) setIsAuthenticated(true);
      if (initialData?.user?.username) {
        sessionStorage.setItem(`unlocked_${initialData.user.username}`, 'true');
      }
    } else if (!isPageOwner) {
       // ...
    } else {
        const targetUser = initialData?.user?.username;
        if (targetUser && sessionStorage.getItem(`unlocked_${targetUser}`) === 'true') {
            if (!isAuthenticated) setIsAuthenticated(true);
        }
    }
  }, [isPageOwner, authAuthenticated, initialData?.user?.username, isAuthenticated]);

  // Update data if prop changes
  useEffect(() => {
    if (initialData.user?.username !== dashboardData.user?.username) {
        setDashboardData(initialData);
    }
  }, [initialData, dashboardData.user?.username]);

  // WebSocket
  const wsUrl = useMemo(() => {
    if (!initialData.user?.username) return null;
    let url = buildWsUrl(`/api/ws/${initialData.user.username}`);
    if (token) url += `?token=${token}`;
    return url;
  }, [initialData.user?.username, token]);

  const handleWebSocketMessage = useCallback((event: MessageEvent) => {
    if (event.data === "REFRESH") {
      console.log("[useUserDashboard] Received REFRESH signal");
      refreshDashboard(token);
    }
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
