import { createContext } from 'react';

/** Authenticated account as persisted in localStorage (`filenexus_user`). */
export interface User {
  username: string;
  folder: string;
  is_locked: boolean;
  first_login: boolean;
  data_retention_days?: number;
  show_in_list: boolean;
  folders: Array<{ id: string; name: string; type: string; parent_id?: string | null }>;
}

/** Value exposed by `useAuth()`. */
export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (userData: User, token: string) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  isAuthenticated: boolean;
}

/** React context carrying the authentication state. */
export const AuthContext = createContext<AuthContextType | undefined>(undefined);
