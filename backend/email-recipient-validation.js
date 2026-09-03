const dns = require('dns').promises;

const DNS_CACHE_TTL_MS = Number(process.env.EMAIL_DOMAIN_CACHE_TTL_MS || 10 * 60 * 1000);
const domainCache = new Map();

function getDomain(address) {
  const value = String(address || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  return at > 0 ? value.slice(at + 1) : '';
}

function isConclusiveMissingDomain(error) {
  return ['ENOTFOUND', 'ENODATA'].includes(error?.code);
}

async function hasAddressRecord(domain, resolver) {
  const attempts = [resolver.resolve4(domain), resolver.resolve6(domain)];
  const results = await Promise.allSettled(attempts);
  if (results.some(result => result.status === 'fulfilled' && result.value?.length > 0)) return true;
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length > 0 && errors.every(isConclusiveMissingDomain)) return false;
  return null;
}

async function inspectMailDomain(domain, { resolver = dns, now = Date.now() } = {}) {
  const cached = domainCache.get(domain);
  if (resolver === dns && cached && cached.expiresAt > now) return cached.result;

  let result;
  try {
    const mx = await resolver.resolveMx(domain);
    if (mx.some(record => !record.exchange || record.exchange === '.')) {
      result = { domain, valid: false, verified: true, reason: 'null_mx' };
    } else if (mx.length > 0) {
      result = { domain, valid: true, verified: true, reason: 'mx' };
    } else {
      const hasAddress = await hasAddressRecord(domain, resolver);
      result = hasAddress === false
        ? { domain, valid: false, verified: true, reason: 'no_mail_host' }
        : { domain, valid: true, verified: hasAddress === true, reason: hasAddress ? 'address_fallback' : 'dns_unavailable' };
    }
  } catch (error) {
    if (isConclusiveMissingDomain(error)) {
      const hasAddress = await hasAddressRecord(domain, resolver);
      result = hasAddress === false
        ? { domain, valid: false, verified: true, reason: error.code === 'ENOTFOUND' ? 'domain_not_found' : 'no_mail_host' }
        : { domain, valid: true, verified: hasAddress === true, reason: hasAddress ? 'address_fallback' : 'dns_unavailable' };
    } else {
      result = { domain, valid: true, verified: false, reason: 'dns_unavailable' };
    }
  }

  if (resolver === dns) domainCache.set(domain, { result, expiresAt: now + DNS_CACHE_TTL_MS });
  return result;
}

async function validateRecipientDomains(recipients, options = {}) {
  const addresses = [...new Set((recipients || []).map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
  const domains = [...new Set(addresses.map(getDomain).filter(Boolean))];
  const checks = await Promise.all(domains.map(domain => inspectMailDomain(domain, options)));
  const byDomain = new Map(checks.map(check => [check.domain, check]));
  const invalid = addresses
    .map(address => ({ address, ...byDomain.get(getDomain(address)) }))
    .filter(check => check.valid === false);
  const unverified = addresses
    .map(address => ({ address, ...byDomain.get(getDomain(address)) }))
    .filter(check => check.verified === false);
  return { valid: invalid.length === 0, invalid, unverified, domains: checks };
}

async function assertDeliverableRecipients(recipients, options = {}) {
  const result = await validateRecipientDomains(recipients, options);
  if (result.valid) return result;

  const error = new Error(`메일을 받을 수 없는 도메인입니다: ${result.invalid.map(item => item.address).join(', ')}`);
  error.statusCode = 422;
  error.payload = {
    error: 'invalid_recipient_domain',
    message: error.message,
    invalidRecipients: result.invalid,
  };
  throw error;
}

module.exports = {
  getDomain,
  inspectMailDomain,
  validateRecipientDomains,
  assertDeliverableRecipients,
};
