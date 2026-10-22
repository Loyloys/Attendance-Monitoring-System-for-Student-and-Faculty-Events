import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetEmailTransportFactory,
  __setEmailConfigForTests,
  __setEmailTransportFactory,
  emailDeliveryStatus,
  sendActionEmail,
} from '../src/services/emailService.js';

const configuredEmail = {
  smtpHost: 'smtp.test.invalid',
  smtpPort: 2525,
  smtpSecure: false,
  smtpUser: '',
  smtpPass: '',
  smtpFrom: 'University Attendance <attendance@example.test>',
  publicAppUrl: 'http://localhost:5173',
  isProduction: false,
};

test('email status lists exact missing delivery configuration', () => {
  __setEmailConfigForTests({
    smtpHost: '',
    smtpPort: 0,
    smtpFrom: '',
    publicAppUrl: '',
    smtpUser: '',
    smtpPass: '',
  });
  try {
    const status = emailDeliveryStatus();
    assert.equal(status.configured, false);
    assert.deepEqual(status.missing, [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_FROM',
      'PUBLIC_APP_URL (an absolute HTTP URL; HTTPS is required in production)',
    ]);
  } finally {
    __resetEmailTransportFactory();
  }
});

test('email delivery is reported successful only when SMTP accepts the recipient', async () => {
  __setEmailConfigForTests(configuredEmail);
  let delivered = false;
  __setEmailTransportFactory(() => ({
    sendMail: async (message) => {
      delivered = true;
      return { accepted: [message.to] };
    },
  }));
  try {
    await sendActionEmail({ to: 'person@example.test', subject: 'Test', text: 'Test message' });
    assert.equal(delivered, true);

    __setEmailTransportFactory(() => ({ sendMail: async () => ({ accepted: [] }) }));
    await assert.rejects(
      sendActionEmail({ to: 'person@example.test', subject: 'Test', text: 'Test message' }),
      (error) => error.status === 503 && /could not be confirmed/.test(error.message),
    );
  } finally {
    __resetEmailTransportFactory();
  }
});
