const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

const BASE_URL = 'https://api.signus.ai';

function out(obj) {
  console.log(JSON.stringify(obj));
  process.exit(0);
}

function fail(msg, details = null) {
  console.log(JSON.stringify({ ok: false, error: msg, details }));
  process.exit(1);
}

function log(msg) {
  console.error(`[DEBUG] ${msg}`);
}

function parsePayload() {
  const args = process.argv.slice(2);
  if (args.length === 0) return {};

  try {
    return JSON.parse(args[0]);
  } catch {
    fail('Invalid JSON payload argument');
  }
}

function ensureIdentity(payload) {
  if (payload.name && String(payload.name).trim()) return;

  if (payload.firstName || payload.lastName) {
    const full = `${payload.firstName || ''} ${payload.lastName || ''}`.trim();
    if (full) {
      payload.name = full;
      delete payload.firstName;
      delete payload.lastName;
      return;
    }
  }

  if (payload.initials && String(payload.initials).trim()) {
    payload.name = String(payload.initials).trim();
    delete payload.initials;
    return;
  }

  fail('Missing required input: name, firstName/lastName, or initials');
}

function listImagesRecursive(dir) {
  const exts = new Set(['.png', '.jpg', '.jpeg', '.webp']);
  const files = [];

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  }

  walk(dir);
  return files.sort();
}

function extractZipBuffer(zipBuffer, outputDir) {
  try {
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(outputDir, true);
  } catch (err) {
    fail('Failed to extract ZIP response', { message: err.message });
  }
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/zip, application/octet-stream, application/json, */*',
    },
    body: JSON.stringify(payload),
  });

  const arrayBuffer = await res.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();

  return {
    ok: res.ok,
    status: res.status,
    contentType,
    body,
    url,
  };
}

async function main() {
  const payload = parsePayload();
  ensureIdentity(payload);

  const countLimit = payload.count ? Number(payload.count) : null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = String(payload.name).replace(/\s+/g, '_');
  const outputDir = path.join(os.homedir(), '.openclaw', 'media', 'signatures-font', `${safeName}-${timestamp}`);
  fs.mkdirSync(outputDir, { recursive: true });
  log(`Output dir: ${outputDir}`);

  const endpoint = `${BASE_URL}/v1/signatures/generations/font`;
  log(`POST ${endpoint}`);
  const response = await postJson(endpoint, payload);

  if (!response.ok) {
    fail('Font generation failed', {
      endpoint,
      status: response.status,
      contentType: response.contentType,
      bodyPreview: response.body.toString('utf8').slice(0, 400),
    });
  }

  if (!(response.contentType.includes('application/zip') || response.contentType.includes('application/octet-stream'))) {
    fail('Expected ZIP archive response from font generation endpoint', {
      endpoint,
      status: response.status,
      contentType: response.contentType,
      bodyPreview: response.body.toString('utf8').slice(0, 400),
    });
  }

  const signatures = [];
  const zipPath = path.join(outputDir, 'font-signatures.zip');
  fs.writeFileSync(zipPath, response.body);
  extractZipBuffer(response.body, outputDir);

  const images = listImagesRecursive(outputDir).filter((f) => !f.endsWith('.zip'));
  const limited = countLimit ? images.slice(0, countLimit) : images;

  if (limited.length === 0) {
    fail('Archive extracted but no image files were found', { outputDir });
  }

  for (let i = 0; i < limited.length; i++) {
    signatures.push({ id: String(i + 1), filePath: limited[i] });
  }

  out({
    ok: true,
    count: signatures.length,
    directory: outputDir,
    signatures,
  });
}

main();
