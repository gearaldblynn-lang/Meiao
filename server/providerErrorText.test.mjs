import assert from 'node:assert/strict';
import test from 'node:test';

import { isProviderErrorText, providerErrorCodeFromText } from './providerErrorText.mjs';

test('isProviderErrorText keeps historical provider error sentinels', () => {
  [
    'Unauthorized – Authentication failed. Please check your API key.',
    'Authentication failed. Please check your credentials.',
    'Server exception, please try again later',
    'The server is currently being maintained, please try again later~',
    'Internal error, please try again later',
    'file mime type is not supported',
    'image download failed',
    'HTTP 404: Not Found',
    'failed to get the file information',
    'please convert or change the file',
  ].forEach((text) => assert.equal(isProviderErrorText(text), true, text));
});

test('isProviderErrorText detects disguised upstream 5xx text', () => {
  [
    'Interal error: HTTP 500',
    'Internal error: HTTP 500',
    'internal server error',
    'HTTP 502',
    'http 503',
    'HTTP 504',
    'Bad Gateway',
    'Gateway Timeout',
    'Service unavailable',
    'upstream error',
    'server error',
  ].forEach((text) => assert.equal(isProviderErrorText(text), true, text));
});

test('isProviderErrorText uses short plain-text structural fallback only for non-json-looking errors', () => {
  assert.equal(isProviderErrorText('unexpected provider error'), true);
  assert.equal(isProviderErrorText('provider returned http 599'), true);
  assert.equal(isProviderErrorText('{"error":"http 599"}'), false);
  assert.equal(isProviderErrorText('[{"error":"http 599"}]'), false);
  assert.equal(isProviderErrorText('正常的策划内容，包含产品卖点和场景描述'), false);
});

test('providerErrorCodeFromText maps retryable upstream text to provider_internal_error', () => {
  [
    'Interal error: HTTP 500',
    'Internal error, please try again later',
    'HTTP 502',
    'Bad Gateway',
    'Gateway Timeout',
    'Service unavailable',
    'upstream error',
    'server error',
    'The server is currently being maintained, please try again later~',
  ].forEach((text) => assert.equal(providerErrorCodeFromText(text), 'provider_internal_error', text));
});

test('providerErrorCodeFromText preserves refusal and bad-response classifications', () => {
  assert.equal(providerErrorCodeFromText('I cannot fulfill this request'), 'provider_refusal');
  assert.equal(providerErrorCodeFromText('无法满足该请求'), 'provider_refusal');
  assert.equal(providerErrorCodeFromText('failed to get the file information'), 'provider_bad_response');
  assert.equal(providerErrorCodeFromText('Unauthorized – Authentication failed'), 'provider_bad_request');
});
