import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

/** Paleta "dark fantasy" sobre os tokens do Material Design 3 (react-native-paper). */
const brand = {
  gold: '#E0B252',
  crimson: '#C4453C',
  teal: '#4FB7A5',
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 3,
  colors: {
    ...MD3DarkTheme.colors,
    primary: brand.gold,
    onPrimary: '#2B1E00',
    primaryContainer: '#4A3A12',
    onPrimaryContainer: '#FFE3A1',
    secondary: brand.crimson,
    onSecondary: '#FFFFFF',
    secondaryContainer: '#5C1B17',
    onSecondaryContainer: '#FFDAD5',
    tertiary: brand.teal,
    onTertiary: '#00201B',
    background: '#15111A',
    onBackground: '#EAE1EE',
    surface: '#1D1823',
    onSurface: '#EAE1EE',
    surfaceVariant: '#2B2432',
    onSurfaceVariant: '#CFC3D6',
    outline: '#8C8496',
    elevation: {
      ...MD3DarkTheme.colors.elevation,
      level1: '#221C29',
      level2: '#28212F',
      level3: '#2E2636',
    },
  },
};

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: 3,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#7A5A00',
    secondary: '#A3322A',
    tertiary: '#006B5E',
  },
};

/** Cores do HUD de combate (fixas: precisam de contraste sobre o trilho escuro nos dois temas). */
export const hud = {
  track: '#241E29',
  trackBorder: '#3A3342',
  healthy: '#3FB950',
  wounded: '#D29922',
  critical: '#F85149',
  bleed: '#8B0000',
  healLead: '#5CE1E6',
  healGlow: '#9BFFB0',
  shield: '#7AA7FF',
  text: '#FFFFFF',
};
