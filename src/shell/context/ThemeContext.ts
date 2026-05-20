import React from 'react';

export interface ThemeContextType {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

export const ThemeContext = React.createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => {},
});
