import type { ExpoConfig } from 'expo/config';

// URL da API: em dev, 10.0.2.2 é o "localhost" do computador visto pelo emulador Android.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080';

const config: ExpoConfig = {
  name: 'RPG Play',
  slug: 'rpg-play',
  scheme: 'rpgplay',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: 'com.pedroasenna.rpgplay',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#15111A',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Backup automático do Android desligado: tokens e dados da ficha não vão para o Google Drive.
    allowBackup: false,
    // Só o necessário. A câmera é opcional e pedida em tempo de execução (só ao tocar em "Tirar foto").
    permissions: ['android.permission.CAMERA', 'android.permission.VIBRATE'],
    // Política de Fotos e Vídeos da Play Store: usamos o Photo Picker do sistema, então nenhuma
    // permissão ampla de mídia pode entrar no manifest (nem via biblioteca).
    blockedPermissions: [
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.pedroasenna.rpgplay',
  },
  plugins: [
    'expo-router',
    [
      'expo-build-properties',
      {
        // Play Store: apps novos e atualizações precisam mirar a API 36 (Android 16) desde 31/08/2026.
        android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 24 },
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'O RPG Play usa a foto que você escolher como retrato do personagem.',
        cameraPermission: 'O RPG Play usa a câmera só quando você escolhe tirar a foto do personagem.',
        microphonePermission: false,
      },
    ],
    [
      'expo-audio',
      {
        // Só tocamos efeitos curtos com o app aberto: sem microfone e sem serviço em primeiro plano.
        microphonePermission: false,
        recordAudioAndroid: false,
        enableBackgroundPlayback: false,
      },
    ],
    'expo-secure-store',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiUrl: API_URL,
    privacyPolicyUrl: 'https://rpgplay.app/privacidade',
    termsUrl: 'https://rpgplay.app/termos',
    accountDeletionUrl: 'https://rpgplay.app/excluir-conta',
  },
};

export default config;
