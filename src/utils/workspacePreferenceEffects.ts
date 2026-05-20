import type { GlobalApiConfig } from '../types';
import { getWorkspacePreferences } from './appState';
import { playCompletionSound, primeCompletionSound } from './soundUtils';

export const primeWorkspaceCompletionSound = async (apiConfig: GlobalApiConfig) => {
  if (!getWorkspacePreferences(apiConfig).playSoundAfterGeneration) return false;
  return primeCompletionSound();
};

export const playWorkspaceCompletionSound = async (apiConfig: GlobalApiConfig) => {
  if (!getWorkspacePreferences(apiConfig).playSoundAfterGeneration) return false;
  return playCompletionSound();
};
