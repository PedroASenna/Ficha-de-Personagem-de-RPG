import Constants from 'expo-constants';

type Extra = { apiUrl?: string; privacyPolicyUrl?: string; termsUrl?: string; accountDeletionUrl?: string };

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const API_URL = (extra.apiUrl ?? 'http://10.0.2.2:8080').replace(/\/$/, '');
export const WS_URL = API_URL.replace(/^http/, 'ws');
export const PRIVACY_POLICY_URL = extra.privacyPolicyUrl ?? 'https://rpgplay.app/privacidade';
export const TERMS_URL = extra.termsUrl ?? 'https://rpgplay.app/termos';
export const ACCOUNT_DELETION_URL = extra.accountDeletionUrl ?? 'https://rpgplay.app/excluir-conta';

/** Em dev a API devolve caminhos relativos (/media/...); em produção, URLs assinadas do GCS. */
export function absoluteUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${API_URL}${url}` : url;
}
