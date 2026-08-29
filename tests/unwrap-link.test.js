'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

/* Real payload captured from a live JustWatch clickout for "The Family Man"
   on Prime Video — see the b18/b19 commit history for how this was found. */
const CX_ONLY_PAYLOAD =
  'eyJzY2hlbWEiOiJpZ2x1OmNvbS5zbm93cGxvd2FuYWx5dGljcy5zbm93cGxvdy9jb250ZXh0cy9qc29uc2NoZW1hLzEtMC0wIiwiZGF0YSI6W3sic2NoZW1hIjoiaWdsdTpjb20uanVzdHdhdGNoL2NsaWNrb3V0X2NvbnRleHQvanNvbnNjaGVtYS8xLTEwLTAiLCJkYXRhIjp7ImRlZXBsaW5rRmFsbGJhY2siOiJodHRwczovL2FwcC5wcmltZXZpZGVvLmNvbS9kZXRhaWw_Z3RpPWFtem4xLmR2Lmd0aS4yY2I2ODY3ZS00MTI4LWYyZDgtYWE4Ny1hOGQ0N2RlNzc3MzUiLCJwcm92aWRlciI6IkFtYXpvbiBQcmltZSBWaWRlbyIsInByb3ZpZGVySWQiOjExOSwibW9uZXRpemF0aW9uVHlwZSI6IkZMQVRSQVRFIiwicHJlc2VudGF0aW9uVHlwZSI6Il80SyIsImN1cnJlbmN5IjoiSU5SIiwicGFydG5lcklkIjoxLCJmaWx0ZXJPcHRpb24iOiJhbGwiLCJyb3dOdW1iZXIiOjAsInBsYWNlbWVudCI6InJlZ3VsYXJfYnV5Ym94IiwiY2xpY2tvdXRUeXBlIjoicmVndWxhciIsImNvdW50cnkiOiJJTiIsIm5vT2ZmZXIiOmZhbHNlfX1dfQ';
const EXPECTED_TARGET = 'https://app.primevideo.com/detail?gti=amzn1.dv.gti.2cb6867e-4128-f2d8-aa87-a8d47de77735';

test('unwrapLink: old t.justwatch.com ?r= format decodes to the real URL', () => {
  const dom = loadApp();
  const raw = 'https://t.justwatch.com/a?uct=1&r=' + encodeURIComponent(EXPECTED_TARGET) + '&x=2';
  assert.equal(dom.window.unwrapLink(raw), EXPECTED_TARGET);
});

test('unwrapLink: newer click.justwatch.com ?cx=-only format decodes via deeplinkFallback', () => {
  const dom = loadApp();
  const raw = 'https://click.justwatch.com/a?cx=' + CX_ONLY_PAYLOAD;
  assert.equal(dom.window.unwrapLink(raw), EXPECTED_TARGET);
});

test('unwrapLink: ?r= takes priority over ?cx= when both are present', () => {
  const dom = loadApp();
  const other = 'https://example.com/other-target';
  const raw = 'https://click.justwatch.com/a?cx=' + CX_ONLY_PAYLOAD + '&r=' + encodeURIComponent(other);
  assert.equal(dom.window.unwrapLink(raw), other);
});

test('unwrapLink: malformed ?cx= falls back to the original URL instead of throwing', () => {
  const dom = loadApp();
  const raw = 'https://click.justwatch.com/a?cx=not-valid-base64!!!';
  assert.equal(dom.window.unwrapLink(raw), raw);
});

test('unwrapLink: ?cx= with no deeplinkFallback in its payload falls back to the original URL', () => {
  const dom = loadApp();
  const payloadWithoutFallback = Buffer.from(JSON.stringify({ data: [{ data: { provider: 'Amazon Prime Video' } }] })).toString('base64');
  const raw = 'https://click.justwatch.com/a?cx=' + payloadWithoutFallback;
  assert.equal(dom.window.unwrapLink(raw), raw);
});

test('unwrapLink: strips Netflix preventIntent=true so the mobile app can open', () => {
  const dom = loadApp();
  const raw = 'https://www.netflix.com/title/81234567?preventIntent=true';
  assert.equal(dom.window.unwrapLink(raw), 'https://www.netflix.com/title/81234567');
});

test('unwrapLink: a plain, non-JustWatch URL passes through unchanged', () => {
  const dom = loadApp();
  const raw = 'https://www.primevideo.com/detail?gti=amzn1.dv.gti.abc123';
  assert.equal(dom.window.unwrapLink(raw), raw);
});

test('unwrapLink: empty and whitespace-only input returns empty string', () => {
  const dom = loadApp();
  assert.equal(dom.window.unwrapLink(''), '');
  assert.equal(dom.window.unwrapLink('   '), '');
});

test('unwrapLink: unparseable garbage is handed back untouched, not thrown', () => {
  const dom = loadApp();
  assert.equal(dom.window.unwrapLink('not a url at all'), 'not a url at all');
});
