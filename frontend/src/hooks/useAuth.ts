import { useContext } from 'react';
import { AuthContext, type AuthContextType } from '../contexts/authContextValue';

/**
 * Access the authentication context.
 *
 * Returns:
 *   Current user, token, and the login/logout/update actions.
 *
 * Raises:
 *   Error if used outside of AuthProvider.
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
