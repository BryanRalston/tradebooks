// Generates self-signed TLS certificates for HTTPS
// Run: node generate-certs.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CERT_DIR = path.join(__dirname, 'certs');
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR);

const keyPath = path.join(CERT_DIR, 'key.pem');
const certPath = path.join(CERT_DIR, 'cert.pem');

if (fs.existsSync(certPath)) {
  console.log('Certificates already exist in certs/');
  process.exit(0);
}

try {
  execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`, { stdio: 'inherit' });
  console.log('Self-signed certificates generated in certs/');
  console.log('HTTPS will be available on port 3144');
} catch (err) {
  console.error('Failed to generate certificates. Make sure openssl is installed.');
  console.error('You can also manually place cert.pem and key.pem in the certs/ directory.');
}
