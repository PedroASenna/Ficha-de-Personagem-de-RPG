import type { ExpoConfig } from 'expo/config';

// App dos jogadores, distribuído como APK (fora da Play Store). O endereço do servidor não vem daqui:
// o app procura o servidor da casa no Wi-Fi, aceita o IP digitado ou lê o QR code do painel do Mestre.
const config: ExpoConfig = {
  name: 'RPG Play',
  slug: 'rpg-play',
  scheme: 'rpgplay',
  version: '0.3.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: 'com.pedroasenna.rpgplay',
    versionCode: 4,
    adaptiveIcon: {
      backgroundColor: '#15111A',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Backup automático do Android desligado: tokens e dados da ficha não saem do aparelho.
    allowBackup: false,
    // Câmera: foto do personagem e QR code da mesa (pedida só na hora de usar). Rede: achar o servidor no Wi-Fi.
    permissions: [
      'android.permission.CAMERA',
      'android.permission.VIBRATE',
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.ACCESS_WIFI_STATE',
    ],
    // Nenhuma permissão ampla: fotos vêm do seletor do sistema e nada roda em segundo plano.
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
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          minSdkVersion: 24,
          // O servidor da casa fala HTTP puro na rede local (http://192.168.x.x:8080).
          usesCleartextTraffic: true,
        },
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
      'expo-camera',
      {
        cameraPermission: 'O RPG Play usa a câmera para ler o QR code da mesa e para a foto do personagem.',
        microphonePermission: false,
        recordAudioAndroid: false,
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
};

export default config;
