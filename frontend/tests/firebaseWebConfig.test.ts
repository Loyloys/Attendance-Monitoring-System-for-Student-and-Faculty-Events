import { describe, expect, it } from 'vitest';
import { parseFirebaseWebConfig } from '../src/data/firebaseWebConfig';

const config = {
  apiKey: 'AIzaSyTestFirebaseWebApiKey000000000',
  authDomain: 'attendance-test.firebaseapp.com',
  projectId: 'attendance-test',
  storageBucket: 'attendance-test.firebasestorage.app',
  messagingSenderId: '696332399690',
  appId: '1:696332399690:web:ccd6602a07a1978b4422b3',
  vapidKey: 'BFDmIchOfLp8j3oZ6drOef3so9oilBl8N8gMlHTdtizj9GTT9e8BMHuBy_mMpg8b2NtwisdIsFJZ6nNZW-aaNVQ',
};

describe('parseFirebaseWebConfig', () => {
  it('accepts a pasted Firebase JavaScript config snippet with the VAPID public key', () => {
    const snippet = `const firebaseConfig = {
      apiKey: "${config.apiKey}",
      authDomain: "${config.authDomain}",
      projectId: "${config.projectId}",
      storageBucket: "${config.storageBucket}",
      messagingSenderId: "${config.messagingSenderId}",
      appId: "${config.appId}",
      measurementId: "G-EXAMPLE",
      vapidKey: "${config.vapidKey}"
    };`;
    expect(parseFirebaseWebConfig(snippet)).toEqual(config);
  });

  it('accepts a JSON object and ignores unused public measurementId', () => {
    expect(parseFirebaseWebConfig(JSON.stringify({ ...config, measurementId: 'G-EXAMPLE' }))).toEqual(config);
  });

  it('reports the exact required value that is missing', () => {
    expect(() => parseFirebaseWebConfig(JSON.stringify({ ...config, vapidKey: undefined })))
      .toThrow(/missing the VAPID public key/);
  });

  it('rejects invalid IDs and service-account or encryption secrets', () => {
    expect(() => parseFirebaseWebConfig(JSON.stringify({ ...config, appId: 'not-an-app-id' })))
      .toThrow(/web app ID is invalid/);
    expect(() => parseFirebaseWebConfig('{"type":"service_account","private_key":"never accept"}'))
      .toThrow(/Do not paste Firebase service-account credentials/);
    expect(() => parseFirebaseWebConfig('{"FCM_TOKEN_ENCRYPTION_KEY":"never accept"}'))
      .toThrow(/Do not paste Firebase service-account credentials/);
  });
});
