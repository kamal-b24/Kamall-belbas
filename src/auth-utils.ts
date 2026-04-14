import { GenerateContentResponse } from "@google/genai";

const SIGNIN_TIMEOUT = 60000; // 60 seconds

/**
 * Opens a popup for Google OAuth and returns a promise that resolves with the
 * access token. Rejects if the user doesn't sign in within the timeout period.
 */
export const getAccessToken = (): Promise<string> => {
  const clientId = process.env.VITE_CLIENT_ID;
  const appUrl = (process.env.VITE_APP_URL && process.env.VITE_APP_URL !== "undefined") 
    ? process.env.VITE_APP_URL 
    : window.location.origin;
  const oauthUrl = `${appUrl}/oauth-redirect.html`;
  const scope = 'https://www.googleapis.com/auth/generative-language.peruserquota';
  const authPopupUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(oauthUrl)}&response_type=token&scope=${encodeURIComponent(scope)}`;
  
  if (!clientId || clientId === "") {
    console.error("VITE_CLIENT_ID is missing. Please set it in the AI Studio Secrets panel.");
    return Promise.reject(new Error('Google Client ID is not configured. Please add VITE_CLIENT_ID to your Secrets.'));
  }

  return new Promise((resolve, reject) => {
    console.log("Opening OAuth popup with URL:", authPopupUrl);
    const authWindow = window.open(authPopupUrl, 'google-signin', 'width=600,height=700');

    if (!authWindow) {
      reject(new Error('Popup blocked. Please allow popups for this site.'));
      return;
    }

    let timeoutId: number | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener('message', handleAuthMessage);
      if (authWindow && !authWindow.closed) {
        authWindow.close();
      }
    };

    const handleAuthMessage = (event: MessageEvent) => {
      console.log("Received message event from origin:", event.origin);
      console.log("Expected origin:", window.location.origin);
      
      // Allow messages from the same origin
      if (event.origin !== window.location.origin) {
        console.warn("Origin mismatch! Skipping message.");
        return;
      }

      if (event.data && event.data.type === 'oauth_success' && event.data.response.access_token) {
        console.log("OAuth success received!");
        cleanup();
        resolve(event.data.response.access_token);
      } else if (event.data && event.data.type === 'oauth_error') {
        console.error("OAuth error received:", event.data.error);
        cleanup();
        reject(new Error(`Google Sign-in error: ${event.data.error}`));
      }
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Sign-in timed out. Please try again.'));
    }, SIGNIN_TIMEOUT);

    window.addEventListener('message', handleAuthMessage);
  });
};

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

/**
 * Calls the Gemini API using the per-user quota endpoint.
 */
export const generateContent = async (accessToken: string, request: { model: string, contents: any }, additionalConfig?: any): Promise<Omit<GenerateContentResponse, 'text' | 'data' | 'functionCalls' | 'executableCode' | 'codeExecutionResult'>> => {
  const url = `https://generativelanguage.googleapis.com/v1alpha/models/${request.model}:generateContentPerUserQuota?access_token=${accessToken}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...additionalConfig, contents: request.contents }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error('API Error:', errorData);

    if (response.status === 429 || errorData.error?.status === 'RESOURCE_EXHAUSTED') {
      throw new QuotaExceededError(errorData.error?.message || 'Quota exceeded. Please upgrade.');
    }

    throw new Error(errorData.error?.message || 'Failed to get a response from the API.');
  }

  return response.json();
};
