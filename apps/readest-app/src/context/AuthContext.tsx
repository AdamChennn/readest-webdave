'use client';

import React, { createContext, useContext, ReactNode } from 'react';

export interface LocalUser {
  id: string;
  email?: string;
}

interface AuthContextType {
  token: string | null;
  user: LocalUser | null;
  login: (_token: string, _user: LocalUser) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  login: () => {},
  logout: () => {},
  refresh: () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  return (
    <AuthContext.Provider
      value={{
        token: null,
        user: null,
        login: () => {},
        logout: () => {},
        refresh: () => {},
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  return useContext(AuthContext);
};
