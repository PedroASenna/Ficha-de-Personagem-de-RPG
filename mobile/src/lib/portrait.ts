/**
 * Foto do personagem: seletor do sistema (Photo Picker no Android 13+, sem permissão de mídia)
 * ou câmera (permissão pedida só aqui), corte quadrado nativo e reencode em JPEG 512px
 * (o reencode também remove o EXIF antes do upload; o servidor reencoda de novo por segurança).
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { api } from './api';

export type PortraitSource = 'library' | 'camera';

export class CameraPermissionDenied extends Error {}

async function pick(source: PortraitSource): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.9,
    exif: false,
  };
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new CameraPermissionDenied('Sem permissão de câmera. Você ainda pode escolher da galeria.');
    const result = await ImagePicker.launchCameraAsync(options);
    return result.canceled ? null : (result.assets[0]?.uri ?? null);
  }
  const result = await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

async function normalize(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 512 });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return saved.uri;
}

/** Fluxo completo: escolher → cortar → reduzir → enviar. Retorna a chave para salvar na ficha. */
export async function choosePortrait(source: PortraitSource): Promise<{ portraitKey: string; url: string; localUri: string } | null> {
  const picked = await pick(source);
  if (!picked) return null;
  const localUri = await normalize(picked);
  const { portrait_key, url } = await api.uploadPortrait(localUri);
  return { portraitKey: portrait_key, url, localUri };
}
