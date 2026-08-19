import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;
const isBase44Configured = Boolean(appId && appBaseUrl);

const noop = () => undefined;
const asyncNoop = async () => null;

const fallbackAuth = {
  me: asyncNoop,
  loginViaEmailPassword: async () => {
    throw new Error('Base44 is not configured for this app.');
  },
  loginWithProvider: noop,
  register: async () => {
    throw new Error('Base44 is not configured for this app.');
  },
  verifyOtp: async () => {
    throw new Error('Base44 is not configured for this app.');
  },
  resendOtp: async () => {
    throw new Error('Base44 is not configured for this app.');
  },
  resetPasswordRequest: async () => {
    throw new Error('Base44 is not configured for this app.');
  },
  resetPassword: async () => {
    throw new Error('Base44 is not configured for this app.');
  },
  setToken: noop,
  logout: noop,
  redirectToLogin: noop,
};

export const isBase44Enabled = isBase44Configured;

export const base44 = isBase44Configured
  ? createClient({
      appId,
      token,
      functionsVersion,
      serverUrl: '',
      requiresAuth: false,
      appBaseUrl,
    })
  : { auth: fallbackAuth };
